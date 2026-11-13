// Pure order transition rules. No payment network calls or credit grants.
// Payment status must come from a separately authenticated provider verification.
export const ORDER_STATES = Object.freeze([
  "created", "pending", "paid_unfulfilled", "fulfilled",
  "failed", "expired", "cancelled", "refunded", "disputed"
]);
const ALLOWED = Object.freeze({
  created: ["pending", "paid_unfulfilled", "failed", "expired", "cancelled"],
  pending: ["paid_unfulfilled", "failed", "expired", "cancelled"],
  paid_unfulfilled: ["fulfilled", "refunded", "disputed"],
  fulfilled: ["refunded", "disputed"],
  failed: [], expired: [], cancelled: [], refunded: [], disputed: []
});
export function transitionOrder(current, next, { verified = false } = {}) {
  if (!ORDER_STATES.includes(current) || !ORDER_STATES.includes(next)) throw new TypeError("Unknown payment state");
  if (current === next) return { state: current, changed: false };
  if (!ALLOWED[current].includes(next)) throw new Error("Invalid payment transition");
  if (["paid_unfulfilled", "refunded", "disputed"].includes(next) && verified !== true)
    throw new Error("Verified provider event required");
  if (next === "fulfilled") throw new Error("Fulfillment must be committed atomically with a unique entitlement grant");
  return { state: next, changed: true };
}
// A provider event is only a *candidate* until signature, merchant, amount,
// currency, order ownership, and provider status have been verified externally.
export function validateOrderPaymentMatch(order, event) {
  if (!order || !event || typeof order !== "object" || typeof event !== "object")
    throw new TypeError("Order and event required");
  if (typeof order.orderId !== "string" || !order.orderId ||
      typeof event.orderId !== "string" || event.orderId !== order.orderId)
    throw new Error("Order identifier mismatch");
  if (!Number.isSafeInteger(order.amountIdr) || order.amountIdr <= 0 ||
      !Number.isSafeInteger(event.amountIdr) || event.amountIdr !== order.amountIdr)
    throw new Error("Payment amount mismatch");
  if (order.currency !== "IDR" || event.currency !== "IDR")
    throw new Error("Payment currency mismatch");
  if (typeof order.environment !== "string" || !["sandbox", "production"].includes(order.environment) ||
      event.environment !== order.environment)
    throw new Error("Payment environment mismatch");
  return true;
}
