// Pure, opt-in monetization primitives. Not wired into production chat or payments.
// All accounting values are non-negative safe integers; unknown provider cost is never zero.
export const MICRO_USD_PER_USD = 1_000_000n;

function nonNegativeSafeInteger(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${name} must be a non-negative safe integer`);
  return BigInt(value);
}
function nonNegativeBigInt(value, name) {
  if (typeof value !== "bigint" || value < 0n) throw new TypeError(`${name} must be a non-negative bigint`);
  return value;
}
function nonEmpty(value, name) {
  if (typeof value !== "string" || !value.trim()) throw new TypeError(`${name} must be a non-empty string`);
  return value;
}
// USD string, e.g. "1.99" -> 1990000 micro-USD. Never accept floating-point money.
export function parseUsdMicro(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d{1,6})?$/.test(value)) throw new TypeError("USD amount must be a decimal string with at most six fractional digits");
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * MICRO_USD_PER_USD + BigInt(fraction.padEnd(6, "0"));
}
export function formatUsdMicro(value) {
  const amount = nonNegativeBigInt(value, "value");
  const whole = amount / MICRO_USD_PER_USD;
  const fraction = (amount % MICRO_USD_PER_USD).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
// Provider rates are micro-USD per million tokens, stored as exact integers.
// Round up provider cost to the nearest micro-USD to avoid underestimating.
export function calculateProviderCostMicroUsd({ inputTokens, outputTokens, inputRateMicroUsdPerMillion, outputRateMicroUsdPerMillion }) {
  const input = nonNegativeSafeInteger(inputTokens, "inputTokens");
  const output = nonNegativeSafeInteger(outputTokens, "outputTokens");
  const inputRate = nonNegativeBigInt(inputRateMicroUsdPerMillion, "inputRateMicroUsdPerMillion");
  const outputRate = nonNegativeBigInt(outputRateMicroUsdPerMillion, "outputRateMicroUsdPerMillion");
  const numerator = input * inputRate + output * outputRate;
  return (numerator + 999_999n) / 1_000_000n;
}
export function validateMeteredUsage({ requestId, provider, model, inputTokens, outputTokens, measured, rateVersion }) {
  nonEmpty(requestId, "requestId");
  nonEmpty(provider, "provider");
  nonEmpty(model, "model");
  nonEmpty(rateVersion, "rateVersion");
  nonNegativeSafeInteger(inputTokens, "inputTokens");
  nonNegativeSafeInteger(outputTokens, "outputTokens");
  if (measured !== true) throw new TypeError("Provider token counts must be measured before financial settlement");
  return { requestId, provider, model, inputTokens, outputTokens, measured, rateVersion };
}
// For UI display only. Credit conversion must be defined by an approved, versioned tariff.
export function calculateRemainingCredits({ granted, spent, reserved }) {
  const balance = nonNegativeBigInt(granted, "granted") - nonNegativeBigInt(spent, "spent") - nonNegativeBigInt(reserved, "reserved");
  if (balance < 0n) throw new RangeError("Credits cannot be overspent");
  return balance;
}
