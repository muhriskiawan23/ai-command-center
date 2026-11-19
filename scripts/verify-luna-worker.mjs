import assert from "node:assert/strict";
import worker from "../src/index.js";
import { createD1, seedSession } from "../tests/e2e/harness.js";

const key = process.env.BOR_TEXT_BACKUP_API_KEY;
if (!process.argv.includes("--run-live") || !key) {
  console.error("Set BOR_TEXT_BACKUP_API_KEY and pass --run-live to send one synthetic Luna request.");
  process.exit(2);
}

const db = createD1();
const user = { id: "synthetic-luna-smoke", email: "luna@example.test" };
const token = seedSession(db, user);
const origin = "https://luna-staging.example.test";
let cloudflareCalls = 0;
const env = {
  DB: db,
  BOR_TEXT_LUNA_PRIMARY: "true",
  BOR_TEXT_BACKUP_ENABLED: "true",
  BOR_TEXT_BACKUP_API_KEY: key,
  BOR_TEXT_BACKUP_DAILY_USD_LIMIT: "0.01",
  AI: { async run() { cloudflareCalls++; throw new Error("Synthetic Workers AI interruption"); } }
};
const request = () => new Request(origin + "/api/chat", {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: origin, Cookie: "__Host-borai_session=" + token },
  body: JSON.stringify({ message: "hi bor", language: "id", requestId: crypto.randomUUID() })
});

const fetchOpenAi = globalThis.fetch;
let requests = 0;
globalThis.fetch = (url, options) => {
  if (url !== "https://api.openai.com/v1/chat/completions" || requests !== 0) {
    throw new Error("Live smoke allows exactly one OpenAI request");
  }
  requests++;
  return fetchOpenAi(url, options);
};

let workerStatus = null;
try {
  const response = await worker.fetch(request(), env);
  workerStatus = response.status;
  const result = await response.json();
  assert.equal(response.status, 200);
  assert.equal(result.model, "gpt-6-luna");
  assert.ok(result.response?.trim());
  assert.equal(cloudflareCalls, 0);
  assert.equal(result.saved, true);

  // Disable Luna by exhausting its budget locally, then verify the routing
  // continues via the Cloudflare binding without a second OpenAI request.
  env.BOR_TEXT_BACKUP_DAILY_USD_LIMIT = "0.000001";
  env.AI.run = async () => { cloudflareCalls++; return { response: "Halo dari Cloudflare simulasi." }; };
  const fallback = await worker.fetch(request(), env);
  assert.equal(fallback.status, 200);
  assert.equal((await fallback.json()).response, "Halo dari Cloudflare simulasi.");
  assert.equal(cloudflareCalls, 1);
  console.log(JSON.stringify({ ok: true, workerStatus, model: "gpt-6-luna", simulatedCloudflareFallback: true }));
} catch {
  console.error(JSON.stringify({ ok: false, workerStatus }));
  process.exitCode = 1;
} finally {
  globalThis.fetch = fetchOpenAi;
  db.sqlite.close();
}
