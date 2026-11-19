import { calculateProviderCostMicroUsd, parseUsdMicro } from "./credit-metering.js";
import { consumeUsage, usageDay } from "./daily-limits.js";
import { DEFAULT_MODEL_ID } from "./model-gateway.js";
import { GPT_OSS_MODEL_ID } from "./gpt-oss.js";

const RATES = new Map([
  [DEFAULT_MODEL_ID, [293_000n, 2_253_000n]],
  [GPT_OSS_MODEL_ID, [350_000n, 750_000n]]
]);
const COUNTER = "provider:workers-ai:text:global:micro-usd";
const TEMPLATE_ALLOWANCE = 8192;

export class TextInferenceBudgetError extends Error {
  constructor(reason) {
    super("Text inference budget unavailable");
    this.name = "TextInferenceBudgetError";
    this.reason = reason;
  }
}

export function withTextInferenceBudget(env) {
  const configured = env.BOR_TEXT_AI_DAILY_USD_LIMIT;
  if (configured === undefined || !env.AI?.run) return env;

  let limit = null;
  try {
    const parsed = parseUsdMicro(configured);
    if (parsed <= BigInt(Number.MAX_SAFE_INTEGER)) limit = Number(parsed);
  } catch {
    // A present but invalid limit must never enable unrestricted paid inference.
  }

  return {
    ...env,
    AI: {
      async run(model, payload, options) {
        // Vision uses a separate payload and quota. Meter each text call,
        // including retries, against the same account-wide text budget.
        if (!payload?.messages) return env.AI.run(model, payload, options);
        const rates = RATES.get(model);
        if (limit === null || !rates || !Array.isArray(payload.messages) ||
          !Number.isSafeInteger(payload.max_tokens) || payload.max_tokens < 1 ||
          !env.DB?.prepare) {
          throw new TextInferenceBudgetError("unavailable");
        }
        if (options?.signal?.aborted) throw options.signal.reason;

        const bytes = new TextEncoder().encode(JSON.stringify(payload.messages)).length;
        const reserved = Number(calculateProviderCostMicroUsd({
          inputTokens: bytes + TEMPLATE_ALLOWANCE,
          outputTokens: payload.max_tokens,
          inputRateMicroUsdPerMillion: rates[0],
          outputRateMicroUsdPerMillion: rates[1]
        }));
        let total;
        try {
          total = await consumeUsage(env, usageDay(), COUNTER, reserved, limit);
        } catch {
          throw new TextInferenceBudgetError("unavailable");
        }
        if (total === null) throw new TextInferenceBudgetError("exhausted");
        // Keep the reservation even if the provider errors. The provider may
        // already have billed the attempt when a timeout or disconnect occurs.
        if (options?.signal?.aborted) throw options.signal.reason;
        return env.AI.run(model, payload, options);
      }
    }
  };
}
