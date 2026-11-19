import assert from "node:assert/strict";
import { DEFAULT_MODEL_ID } from "../src/model-gateway.js";
import { BACKUP_MODEL, withTextProviderFailover } from "../src/text-provider-failover.js";

if (!process.argv.includes("--run-live") || !process.env.BOR_TEXT_BACKUP_API_KEY) {
  console.error("Set BOR_TEXT_BACKUP_API_KEY to the staging project key and pass --run-live for one synthetic OpenAI request.");
  process.exit(2);
}

let providerStatus;
const env = withTextProviderFailover({
  BOR_TEXT_BACKUP_ENABLED: "true",
  BOR_TEXT_BACKUP_API_KEY: process.env.BOR_TEXT_BACKUP_API_KEY,
  BOR_TEXT_BACKUP_DAILY_USD_LIMIT: "0.01",
  DB: { prepare: () => ({ bind: (day, subject, cost, now, limit) => ({
    first: async () => cost <= limit ? { units: cost } : null
  }) }) },
  AI: { async run() {
    throw Object.assign(new Error("Synthetic Workers AI capacity failure"), { code: 3040, status: 429 });
  } }
}, async (url, options) => {
  const response = await fetch(url, options);
  providerStatus = response.status;
  return response;
});

try {
  const result = await env.AI.run(DEFAULT_MODEL_ID, {
    messages: [{ role: "user", content: "Balas dengan dua kata ini saja: Halo Indonesia" }],
    max_tokens: 32
  });
  assert.equal(result.borTextBackupModel, BACKUP_MODEL);
  assert.match(result.response, /^\s*halo indonesia[.!]?\s*$/i);
  console.log(JSON.stringify({ ok: true, providerStatus, model: BACKUP_MODEL }));
} catch {
  console.error(JSON.stringify({ ok: false, providerStatus: providerStatus ?? null, model: BACKUP_MODEL }));
  process.exitCode = 1;
}
