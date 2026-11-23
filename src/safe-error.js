// Operational logs must not serialize provider errors, messages, stacks, URLs or tokens.
const ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "AiTimeoutError"]);
export function safeError(error) {
  try { const name = error?.name; return { name: ERROR_NAMES.has(name) ? name : "UnknownError" }; }
  catch { return { name: "UnknownError" }; }
}
// Only fixed diagnostic categories and documented numeric Cloudflare AI codes may
// enter logs. Never serialize exception name/message, stack, cause, request or output.
const WORKERS_AI_CODES = Object.freeze({
  5007: "model_not_found",
  5004: "invalid_input",
  3003: "incomplete_request",
  5018: "model_access_denied",
  5016: "model_agreement_required",
  3023: "account_blocked",
  3041: "model_access_denied",
  5035: "paid_plan_required",
  5019: "outdated_sdk",
  5005: "unsupported_lora",
  3042: "invalid_model_id",
  5028: "model_deprecated",
  3006: "request_too_large",
  3007: "upstream_timeout",
  3008: "upstream_aborted",
  3036: "daily_ai_allocation_exhausted",
  3040: "provider_capacity_exceeded"
});

function documentedCode(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  return Number.isInteger(n) && Object.hasOwn(WORKERS_AI_CODES, n) ? n : null;
}

function httpStatus(value) {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const n = Number(value);
  return Number.isInteger(n) && n >= 400 && n <= 599 ? n : null;
}

export function safeAiBindingFailure(error) {
  try {
    const codeCandidates = [
      error?.code, error?.providerCode,
      error?.cause?.code, error?.cause?.providerCode,
      error?.errors?.[0]?.code, error?.data?.errors?.[0]?.code,
      error?.response?.errors?.[0]?.code
    ];
    const code = codeCandidates.map(documentedCode).find((value) => value !== null) ?? null;
    const statusCandidates = [
      error?.status, error?.statusCode, error?.httpStatus,
      error?.cause?.status, error?.response?.status
    ];
    const status = statusCandidates.map(httpStatus).find((value) => value !== null) ?? null;
    // A generic wrapper code can accompany this exact known free-tier text.
    // Do not treat unrelated 429s or unknown messages as daily exhaustion.
    const quotaMessage = [error?.message, error?.cause?.message, error?.errors?.[0]?.message]
      .some(message => typeof message === "string" &&
        /^(?:AiError:\s*)*you have used up your daily free allocation of 10,000 neurons\b/i.test(message.trim()));
    return {
      category: code !== null ? WORKERS_AI_CODES[code] :
        quotaMessage ? "daily_ai_allocation_exhausted" : "provider_error_unclassified",
      providerCode: code,
      httpStatus: status
    };
  } catch {
    return { category: "provider_error_unclassified", providerCode: null, httpStatus: null };
  }
}
