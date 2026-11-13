import test from "node:test";
import assert from "node:assert/strict";
import { parseUsdMicro, formatUsdMicro, calculateProviderCostMicroUsd, validateMeteredUsage, calculateRemainingCredits } from "../src/credit-metering.js";

test("USD parsing and formatting use exact micro-USD", () => {
  assert.equal(parseUsdMicro("1.99"), 1990000n);
  assert.equal(parseUsdMicro("6.99"), 6990000n);
  assert.equal(parseUsdMicro("0.000001"), 1n);
  assert.equal(formatUsdMicro(1990000n), "1.99");
  assert.equal(formatUsdMicro(1n), "0.000001");
  for (const invalid of ["1e3", "-1", "1.0000001", "01", "1.", 1.99, "NaN"]) assert.throws(() => parseUsdMicro(invalid));
});
test("provider cost uses exact integer math and rounds upward", () => {
  assert.equal(calculateProviderCostMicroUsd({inputTokens:1000,outputTokens:2000,inputRateMicroUsdPerMillion:1000000n,outputRateMicroUsdPerMillion:2000000n}), 5000n);
  assert.equal(calculateProviderCostMicroUsd({inputTokens:1,outputTokens:0,inputRateMicroUsdPerMillion:1n,outputRateMicroUsdPerMillion:0n}), 1n);
  assert.throws(() => calculateProviderCostMicroUsd({inputTokens:NaN,outputTokens:0,inputRateMicroUsdPerMillion:1n,outputRateMicroUsdPerMillion:0n}));
  assert.throws(() => calculateProviderCostMicroUsd({inputTokens:1,outputTokens:0,inputRateMicroUsdPerMillion:null,outputRateMicroUsdPerMillion:0n}));
});
test("unknown or estimated usage is rejected for financial settlement", () => {
  const usage={requestId:"req-1",provider:"cloudflare",model:"model-1",inputTokens:100,outputTokens:20,rateVersion:"v1",measured:true};
  assert.deepEqual(validateMeteredUsage(usage),usage);
  assert.throws(() => validateMeteredUsage({...usage,measured:false}));
  assert.throws(() => validateMeteredUsage({...usage,outputTokens:-1}));
  assert.throws(() => validateMeteredUsage({...usage,requestId:""}));
});
test("available credit accounting rejects overspend and invalid balances", () => {
  assert.equal(calculateRemainingCredits({granted:100n,spent:35n,reserved:25n}),40n);
  assert.throws(() => calculateRemainingCredits({granted:10n,spent:11n,reserved:0n}));
  assert.throws(() => calculateRemainingCredits({granted:10n,spent:-1n,reserved:0n}));
});
