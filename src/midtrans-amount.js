// Strict parsing for Midtrans gross_amount. Never use floating-point currency math.
// This is a pure validation helper, not payment verification.
export function parseMidtransGrossAmountIdr(value) {
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(value))
    throw new TypeError("Invalid Midtrans gross_amount format");
  const [whole, fraction = ""] = value.split(".");
  if (fraction.padEnd(2,"0") !== "00") throw new Error("Non-integral IDR amount");
  const amount = BigInt(whole);
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER)) throw new RangeError("IDR amount outside safe range");
  return Number(amount);
}
export function assertMidtransPaymentMatchesOrder(order, payload, environment) {
  if (!order || !payload || typeof order !== "object" || typeof payload !== "object")
    throw new TypeError("Order and notification required");
  if (typeof order.orderId !== "string" || !order.orderId || payload.order_id !== order.orderId)
    throw new Error("Payment order mismatch");
  if (!Number.isSafeInteger(order.amountIdr) || order.amountIdr <= 0 ||
      parseMidtransGrossAmountIdr(payload.gross_amount) !== order.amountIdr)
    throw new Error("Payment amount mismatch");
  if (order.currency !== "IDR") throw new Error("Unexpected order currency");
  if (!["sandbox","production"].includes(environment) || order.environment !== environment)
    throw new Error("Payment environment mismatch");
  return true;
}
