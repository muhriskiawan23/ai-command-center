import { calculateProviderCostMicroUsd, parseUsdMicro } from "./credit-metering.js";
import { consumeUsage, usageDay } from "./daily-limits.js";
import { DEFAULT_MODEL_ID } from "./model-gateway.js";
import { safeAiBindingFailure } from "./safe-error.js";

export const BACKUP_MODEL = "gpt-6-luna";
const ENDPOINT = "https://api.openai.com/v1/chat/completions";
const COUNTER = "provider:openai:backup:text:global:micro-usd";

function mayFailOver(error) {
  const failure = safeAiBindingFailure(error);
  if (["daily_ai_allocation_exhausted", "provider_capacity_exceeded", "upstream_timeout"].includes(failure.category)) return true;
  if (failure.httpStatus === 429 || failure.httpStatus >= 500) return true;
  return typeof error?.message === "string" &&
    /^(?:AiError:\s*)*you have used up your daily free allocation of 10,000 neurons\b/i.test(error.message);
}

export function withTextProviderFailover(env, fetcher = fetch) {
  if (env.BOR_TEXT_BACKUP_ENABLED !== "true" || !env.BOR_TEXT_BACKUP_API_KEY ||
    !env.DB?.prepare || !env.AI?.run) return env;

  let limit;
  try {
    const parsed = parseUsdMicro(env.BOR_TEXT_BACKUP_DAILY_USD_LIMIT);
    if (parsed <= 0n || parsed > BigInt(Number.MAX_SAFE_INTEGER)) return env;
    limit = Number(parsed);
  } catch {
    return env;
  }

  const preferLuna = env.BOR_TEXT_LUNA_PRIMARY === "true";
  let attempted = false;

  async function tryLuna(payload, signal) {
    if (signal?.aborted || !Array.isArray(payload?.messages) ||
      !payload.messages.length || !payload.messages.every(message =>
        ["system", "assistant", "user"].includes(message?.role) &&
        typeof message.content === "string") ||
      !Number.isSafeInteger(payload.max_tokens) || payload.max_tokens < 1 ||
      payload.max_tokens > 2200) return null;

    const messages = payload.messages.map(({ role, content }) => ({ role, content }));
    const bytes = new TextEncoder().encode(JSON.stringify(messages)).length;
    if (bytes > 64_000) return null;
    const reserved = Number(calculateProviderCostMicroUsd({
      inputTokens: bytes + 8192,
      outputTokens: payload.max_tokens,
      inputRateMicroUsdPerMillion: 100_000n,
      outputRateMicroUsdPerMillion: 500_000n
    }));
    try {
      const total = await consumeUsage(env, usageDay(), COUNTER, reserved, limit);
      if (total === null || signal?.aborted) return null;
      const timeout = AbortSignal.timeout(8000);
      const response = await fetcher(ENDPOINT, {
        method: "POST",
        redirect: "manual",
        headers: {
          Authorization: "Bearer " + env.BOR_TEXT_BACKUP_API_KEY,
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          model: BACKUP_MODEL, messages, store: false, reasoning_effort: "none",
          max_completion_tokens: payload.max_tokens
        }),
        signal: signal ? AbortSignal.any([signal, timeout]) : timeout
      });
      if (!response.ok) return null;
      const result = await response.json();
      const answer = result.choices?.[0]?.message?.content;
      if (typeof answer === "string" && answer.trim()) {
        return { response: answer, borTextBackupModel: BACKUP_MODEL, borTextLunaPrimary: preferLuna };
      }
    } catch {
      // Paid attempts remain reserved even if their outcome is ambiguous.
    }
    return null;
  }

  return {
    ...env,
    AI: {
      async run(model, payload, options) {
        const signal = options?.signal;
        if (model !== DEFAULT_MODEL_ID) return env.AI.run(model, payload, options);
        if (preferLuna) {
          signal?.throwIfAborted();
          const answer = await tryLuna(payload, signal);
          if (answer) return answer;
          signal?.throwIfAborted();
          return env.AI.run(model, payload, options);
        }
        try {
          return await env.AI.run(model, payload, options);
        } catch (primaryError) {
          if (attempted || signal?.aborted || !mayFailOver(primaryError)) throw primaryError;
          attempted = true;
          const answer = await tryLuna(payload, signal);
          if (answer) return answer;
          throw primaryError;
        }
      }
    }
  };
}
