import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/luna-staging-worker.js";
import { createD1 } from "./e2e/harness.js";

const operator = "synthetic-operator";
const invoke = (path, env, token = operator) => worker.fetch(new Request("https://staging.example" + path, {
  method: "POST", headers: { authorization: "Bearer " + token },
  body: '{"query":"caller-supplied query must be ignored"}'
}), { BOR_LUNA_STAGING_TOKEN: operator, ...env });

test("the staging-only routes require authorization and individual opt-in", async () => {
  for (const path of ["/smoke/web-search", "/smoke/url-reader"]) {
    assert.equal((await invoke(path, {}, "wrong-operator")).status, 401);
    const disabled = await invoke(path, {});
    assert.equal(disabled.status, 503);
    assert.equal((await disabled.json()).error, "staging_smoke_disabled");
  }
});

test("staging smoke reuses the staging Luna binding for one fixed, cited Responses request", async (t) => {
  const DB = createD1();
  t.after(() => DB.sqlite.close());
  const captured = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    captured.push({ url, options });
    return Response.json({ status: "completed", output: [
      { type: "web_search_call", status: "completed" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: "Official site.",
        annotations: [{ type: "url_citation", url: "https://example.org/", start_index: 0, end_index: 14 }] }] }
    ] });
  });
  const env = { DB, BOR_LUNA_STAGING_WEB_SEARCH_ENABLED: "true", BOR_TEXT_BACKUP_API_KEY: "synthetic-key" };
  const response = await invoke("/smoke/web-search", env);
  assert.deepEqual(await response.json(), { ok: true, providerStatus: 200, citationsPresent: true });
  assert.equal(captured.length, 1);
  assert.equal(captured[0].url, "https://api.openai.com/v1/responses");
  assert.equal(captured[0].options.headers.Authorization, "Bearer synthetic-key");
  const body = JSON.parse(captured[0].options.body);
  assert.equal(body.model, "gpt-6-luna");
  assert.match(body.input, /Hamad International Airport/);
  assert.doesNotMatch(body.input, /caller-supplied/);
  assert.equal((await invoke("/smoke/web-search", env)).status, 503);
  assert.equal(captured.length, 1);
});

test("staging URL Reader hands fixed checks to the verified binding and exposes booleans only", async () => {
  const env = { BOR_LUNA_STAGING_URL_READER_ENABLED: "true", EGRESS_PROXY_TOKEN: "x".repeat(40) };
  assert.equal((await invoke("/smoke/url-reader", env)).status, 503);
  env.EGRESS_PROXY = { async fetch(_url, options) {
    if (options.headers.authorization !== "Bearer " + env.EGRESS_PROXY_TOKEN) return new Response(null, { status: 401 });
    const { url } = JSON.parse(options.body);
    if (url.startsWith("https://[::1]")) return Response.json({ error: "invalid_hostname" }, { status: 502 });
    if (url !== "https://example.com/") return Response.json({ error: "unsafe_ip_literal" }, { status: 502 });
    return Response.json({ status: 200, peerIp: "1.1.1.1", bodyBase64: btoa("Example Domain"), transport: {
      peerIpVerified: true, selectedPeerIp: "1.1.1.1", observedPeerIp: "1.1.1.1",
      tlsAuthorized: true, tlsIdentityVerified: true, tlsServername: "example.com"
    } });
  } };
  const response = await invoke("/smoke/url-reader", env);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, checks: {
    authenticationDenied: true, unsafeDestinationsDenied: true, productionAdapterPeerAndTlsVerified: true
  } });
});

test("the HTTP staging fallback defaults off and refuses wrong one-time codes", async () => {
  const path = "https://staging.example/__staging-evaluation";
  const code = "synthetic-code";
  const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code)))]
    .map(byte => byte.toString(16).padStart(2, "0")).join("");
  assert.equal((await worker.fetch(new Request(path), {})).status, 404);
  const env = { BOR_LUNA_LIVE_TRIGGER_DIGEST: digest, BOR_LUNA_LIVE_EVAL_EXPIRES_AT: String(Date.now() + 60000) };
  const page = await worker.fetch(new Request(path), env);
  assert.match(await page.text(), /type="password"/);
  const form = "code=wrong";
  const rejected = await worker.fetch(new Request(path, {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", "Content-Length": String(form.length),
      Origin: "https://staging.example" }, body: form
  }), env);
  assert.equal(rejected.status, 401);
});
