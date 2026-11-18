// Proposed paid-AI call gate: isolated from all production routes.
// NO caller enables it until pricing, metering, global spend-budget and
// reconciliation controls have completed their separate launch gates.
import { reserveCredits, finalizeCredits } from "./credit-ledger.js";
import { calculateProviderCostMicroUsd, validateMeteredUsage } from "./credit-metering.js";

const MAX = BigInt(Number.MAX_SAFE_INTEGER);
const safeId = (value) => typeof value === "string" && value.trim() && value.length <= 200;
function positive(value, label) {
  if (typeof value !== "bigint" || value <= 0n || value > MAX)
    throw new TypeError(label + " must be a positive safe bigint");
  return value;
}
function boundedTokens(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > 24000)
    throw new TypeError(label + " must be a positive bounded integer");
  return value;
}
function ceilDiv(a, b) { return (a + b - 1n) / b; }
function creditsForCost(costMicroUsd, tariff) {
  if (costMicroUsd === 0n) return 0n;
  const result = ceilDiv(costMicroUsd * tariff.creditNumerator, tariff.creditDenominator);
  if (result <= 0n || result > MAX) throw new RangeError("Credit cost outside safe range");
  return result;
}
function checkedTariff(tariff) {
  if (!tariff || !safeId(tariff.version) || !safeId(tariff.provider) || !safeId(tariff.model))
    throw new TypeError("Approved versioned tariff required");
  if (tariff.approved !== true) throw new TypeError("Tariff must be explicitly approved");
  const checked = {
    ...tariff,
    inputRateMicroUsdPerMillion: positive(tariff.inputRateMicroUsdPerMillion, "input rate"),
    outputRateMicroUsdPerMillion: positive(tariff.outputRateMicroUsdPerMillion, "output rate"),
    creditNumerator: positive(tariff.creditNumerator, "credit numerator"),
    creditDenominator: positive(tariff.creditDenominator, "credit denominator"),
    maxCallMicroUsd: positive(tariff.maxCallMicroUsd, "USD spend ceiling"),
    maxCallMicrocredits: positive(tariff.maxCallMicrocredits, "credit spend ceiling")
  };
  return checked;
}

// Quote a conservative ceiling using the entire verified model context window,
// not an untrusted client estimate. This does NOT assert that an actual prompt
// fits the window; callers must enforce model context limits separately.
export function quoteBillableInference({ tariff, maxInputTokens, maxOutputTokens }) {
  const policy = checkedTariff(tariff);
  const input = boundedTokens(maxInputTokens, "maxInputTokens");
  const output = boundedTokens(maxOutputTokens, "maxOutputTokens");
  const cost = calculateProviderCostMicroUsd({
    inputTokens: input,
    outputTokens: output,
    inputRateMicroUsdPerMillion: policy.inputRateMicroUsdPerMillion,
    outputRateMicroUsdPerMillion: policy.outputRateMicroUsdPerMillion
  });
  const credits = creditsForCost(cost, policy);
  if (cost === 0n || cost > policy.maxCallMicroUsd || credits > policy.maxCallMicrocredits)
    return { allowed: false, reason: "call_spend_ceiling_exceeded" };
  return { allowed: true, maxProviderCostMicroUsd: cost, reservedMicrocredits: credits };
}

// Cloudflare response usage is not assumed: two authoritative counter fields
// must both exist. Do not estimate by string length or count one retry as free.
export function measuredModelUsage(response) {
  const usage = response?.usage;
  if (!usage || typeof usage !== "object" || Array.isArray(usage)) return null;
  const pairs = [
    ["prompt_tokens", "completion_tokens"],
    ["input_tokens", "output_tokens"]
  ];
  let measured = null;
  for (const [input, output] of pairs) {
    const hasInput = Object.hasOwn(usage, input);
    const hasOutput = Object.hasOwn(usage, output);
    if (!hasInput && !hasOutput) continue;
    // Reject a partial or invalid alias even if a different alias is valid.
    if (!hasInput || !hasOutput ||
        !Number.isSafeInteger(usage[input]) || usage[input] < 0 ||
        !Number.isSafeInteger(usage[output]) || usage[output] < 0)
      return null;
    if (measured &&
        (measured.inputTokens !== usage[input] || measured.outputTokens !== usage[output]))
      return null;
    measured = { inputTokens: usage[input], outputTokens: usage[output] };
  }
  if (!measured) return null;
  const total = measured.inputTokens + measured.outputTokens;
  if (!Number.isSafeInteger(total) || total <= 0) return null;
  // When a provider reports the total, it must agree with the complete pair.
  if (Object.hasOwn(usage, "total_tokens") &&
      (!Number.isSafeInteger(usage.total_tokens) || usage.total_tokens !== total))
    return null;
  return measured;
}

// All callbacks are trusted server-side dependencies, never client-supplied.
// The provider budget MUST reserve atomically across users and days, then
// settle the measured amount. That D1 implementation is a separate launch gate.
export async function runReservedBillableInference({
  env, userId, requestId, tariff, maxInputTokens, maxOutputTokens,
  invokeModel, providerBudget, ledger = { reserve: reserveCredits, finalize: finalizeCredits }
}) {
  if (!env?.DB?.prepare || !safeId(userId) || !safeId(requestId) ||
      typeof invokeModel !== "function" ||
      typeof ledger?.reserve !== "function" || typeof ledger?.finalize !== "function" ||
      typeof providerBudget?.reserve !== "function" || typeof providerBudget?.settle !== "function")
    throw new TypeError("Authenticated user, D1, inference, ledger and atomic provider budget required");
  const policy = checkedTariff(tariff);
  const quote = quoteBillableInference({ tariff: policy, maxInputTokens, maxOutputTokens });
  if (!quote.allowed) return { ok: false, reason: quote.reason, modelInvoked: false };
  const budgetId = "ai:" + requestId;
  let budget;
  try {
    budget = await providerBudget.reserve({
      id: budgetId, provider: policy.provider, model: policy.model,
      maximumMicroUsd: quote.maxProviderCostMicroUsd
    });
  } catch {
    return { ok: false, reason: "provider_budget_unavailable", modelInvoked: false };
  }
  if (budget?.ok !== true)
    return { ok: false, reason: "provider_budget_rejected", modelInvoked: false };

  let reserved;
  try {
    reserved = await ledger.reserve(env, {
      userId, requestId, amountMicrocredits: quote.reservedMicrocredits
    });
  } catch { reserved = null; }
  if (reserved?.ok !== true) {
    // No provider call took place, so release the reserved global budget.
    try {
      await providerBudget.settle({ id: budgetId, actualMicroUsd: 0n });
    } catch { /* Keep the budget reserved conservatively. */ }
    return { ok: false, reason: "credit_reservation_rejected", modelInvoked: false };
  }

  // Once dispatched, failures or missing usage might still incur upstream
  // charges. Never release either reservation based only on an exception.
  let response;
  try {
    response = await invokeModel({ model: policy.model, maxOutputTokens });
  } catch {
    return { ok: false, reason: "provider_outcome_unknown_reservations_held", modelInvoked: true };
  }
  const usage = measuredModelUsage(response);
  if (!usage || usage.inputTokens > maxInputTokens || usage.outputTokens > maxOutputTokens)
    return { ok: false, reason: "metering_unverified_reservations_held", modelInvoked: true };
  try {
    validateMeteredUsage({
      requestId, provider: policy.provider, model: policy.model,
      inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
      measured: true, rateVersion: policy.version
    });
  } catch {
    return { ok: false, reason: "metering_unverified_reservations_held", modelInvoked: true };
  }
  const actualCost = calculateProviderCostMicroUsd({
    inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    inputRateMicroUsdPerMillion: policy.inputRateMicroUsdPerMillion,
    outputRateMicroUsdPerMillion: policy.outputRateMicroUsdPerMillion
  });
  let debit;
  try { debit = creditsForCost(actualCost, policy); }
  catch { return { ok: false, reason: "metering_unverified_reservations_held", modelInvoked: true }; }
  if (actualCost > quote.maxProviderCostMicroUsd || debit > quote.reservedMicrocredits)
    return { ok: false, reason: "inference_cost_over_ceiling_reservations_held", modelInvoked: true };

  // Do not expose paid results until budget and customer debit are settled.
  try {
    const settled = await providerBudget.settle({ id: budgetId, actualMicroUsd: actualCost });
    if (settled?.ok !== true)
      return { ok: false, reason: "provider_budget_settlement_failed_reservations_held", modelInvoked: true };
  } catch {
    return { ok: false, reason: "provider_budget_settlement_failed_reservations_held", modelInvoked: true };
  }
  try {
    const settled = await ledger.finalize(env, { userId, requestId, settledMicrocredits: debit });
    if (settled?.ok !== true)
      return { ok: false, reason: "credit_settlement_failed_reservation_held", modelInvoked: true };
  } catch {
    return { ok: false, reason: "credit_settlement_failed_reservation_held", modelInvoked: true };
  }
  return {
    ok: true, response, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens,
    providerCostMicroUsd: actualCost, customerDebitMicrocredits: debit,
    tariffVersion: policy.version, modelInvoked: true
  };
}
