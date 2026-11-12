// Operational logs must not serialize provider errors, messages, stacks, URLs or tokens.
const ERROR_NAMES = new Set(["Error", "TypeError", "RangeError", "SyntaxError", "AbortError", "TimeoutError", "AiTimeoutError"]);
export function safeError(error) {
  try { const name = error?.name; return { name: ERROR_NAMES.has(name) ? name : "UnknownError" }; }
  catch { return { name: "UnknownError" }; }
}
