// Operational logs must not serialize provider errors, messages, stacks, URLs or tokens.
const ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "AiTimeoutError"]);
export function safeError(error) {
  try { return { name: ERROR_NAMES.has(error?.name) ? error.name : "UnknownError" }; }
  catch { return { name: "UnknownError" }; }
}
