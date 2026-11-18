import { consumeUsage, usageDay } from "./daily-limits.js";

export const GPT_OSS_MODEL_ID = "@cf/openai/gpt-oss-120b";
export const GPT_OSS_USD_PER_M_INPUT = 0.35;
export const GPT_OSS_USD_PER_M_OUTPUT = 0.75;
export const GPT_OSS_MAX_CALLS_PER_TURN = 2;
const MAX_INPUT_BYTES = 42000;
const INPUT_OVERHEAD_BYTES = 8192;
const MAX_DAILY_USD = 10;

// An explicit owner-enabled, signed-in-only canary, not a claim of quality parity.
// The global atomic D1 budget prevents paid inference from multiplying across isolates.
export function mayUseGptOss(env, agentId) {
  return env?.BOR_GPT_OSS_ENABLED === "true" &&
    env?.BOR_AUTHENTICATED === true &&
    env?.MODEL_TRACE?.gptOssDegraded !== true &&
    ["coordinator", "analyst", "writer", "coder", "researcher"].includes(agentId);
}

export function worstCaseGptOssMicroUsd(messages, maxOutputTokens, additionalInputBytes = 0) {
  if (!Array.isArray(messages) || !Number.isSafeInteger(maxOutputTokens) ||
    maxOutputTokens < 1 || maxOutputTokens > 2200) return null;
  if (!Number.isSafeInteger(additionalInputBytes) || additionalInputBytes < 0 ||
    additionalInputBytes > 40000) return null;
  const bytes = new TextEncoder().encode(JSON.stringify(messages)).length + additionalInputBytes;
  if (bytes > MAX_INPUT_BYTES) return null;
  // Byte count is a conservative upper bound for BPE token count; include
  // overhead for response-language and memory guards applied by wrappers.
  return Math.ceil((bytes + INPUT_OVERHEAD_BYTES) * GPT_OSS_USD_PER_M_INPUT +
    maxOutputTokens * GPT_OSS_USD_PER_M_OUTPUT);
}

export async function reserveGptOssCall(env, messages, maxOutputTokens) {
  const trace = env?.MODEL_TRACE;
  if (!Array.isArray(trace) || !env?.DB?.prepare) return { allowed: false, reason: "budget_unavailable" };
  if ((trace.gptOssReservedCalls || 0) >= GPT_OSS_MAX_CALLS_PER_TURN) {
    return { allowed: false, reason: "per_turn_cap" };
  }
  const microUsd = worstCaseGptOssMicroUsd(messages, maxOutputTokens, Number(env.BOR_EXTRA_INPUT_BYTES || 0));
  if (microUsd === null) return { allowed: false, reason: "input_or_output_limit" };
  const rawLimit = String(env.BOR_GPT_OSS_DAILY_USD_LIMIT ?? "0.25");
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/.test(rawLimit)) return { allowed: false, reason: "invalid_limit" };
  const dailyUsd = Number(rawLimit);
  if (!Number.isFinite(dailyUsd) || dailyUsd <= 0 || dailyUsd > MAX_DAILY_USD) {
    return { allowed: false, reason: "invalid_limit" };
  }
  try {
    const limitMicroUsd = Math.floor(dailyUsd * 1_000_000);
    const reserved = await consumeUsage(env, usageDay(), "provider:gpt-oss-120b:global:micro-usd", microUsd, limitMicroUsd);
    if (reserved === null) return { allowed: false, reason: "global_daily_cap" };
    trace.gptOssReservedCalls = (trace.gptOssReservedCalls || 0) + 1;
    return { allowed: true, reservedMicroUsd: microUsd };
  } catch {
    return { allowed: false, reason: "budget_unavailable" };
  }
}

// Cloudflare Workers AI may return the text-generation shape or a Responses
// API shape. Only user-visible output_text is returned, never reasoning traces.
export function extractModelAnswer(result) {
  const direct = result?.response ?? result?.result?.response;
  if (typeof direct === "string") return direct;
  if (typeof result?.output_text === "string") return result.output_text;
  // Some Workers AI frontends return a chat-completions envelope rather than
  // the Responses envelope. Read only final assistant content, never thoughts.
  const choices = result?.choices ?? result?.result?.choices;
  const first = Array.isArray(choices) ? choices[0]?.message : null;
  if (first?.role === "assistant" && typeof first.content === "string") return first.content;
  const outputs = result?.output ?? result?.result?.output;
  if (!Array.isArray(outputs)) return "";
  return outputs.filter(item => item?.type === "message").flatMap(item =>
    Array.isArray(item.content) ? item.content : []
  ).filter(part => part?.type === "output_text" && typeof part.text === "string")
    .map(part => part.text).join("\n");
}
