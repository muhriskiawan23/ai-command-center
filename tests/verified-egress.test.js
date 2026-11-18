import test from "node:test";
import assert from "node:assert/strict";
import { createVerifiedLinkFetcher,MAX_PROXY_RESPONSE_BYTES } from "../src/verified-egress.js";

const token = "a".repeat(48);
function fakeEnv(handler) {
  return { URL_READER_ENABLED: "true", EGRESS_PROXY_TOKEN: token, EGRESS_PROXY: { fetch: handler } };
}
function payload(overrides = {}) {
  return { status: 200, headers: { "content-type": "text/plain" },
    bodyBase64: btoa("This is a public page with enough text for the reader."),
    peerIp: "93.184.215.14",
    transport: { selectedPeerIp: "93.184.215.14", observedPeerIp: "93.184.215.14",
      peerIpVerified: true, tlsAuthorized: true, tlsIdentityVerified: true,
      tlsServername: "example.com" }, ...overrides };
}
test("reader remains off without private binding and token", () => {
  assert.equal(createVerifiedLinkFetcher({}), null);
  assert.equal(createVerifiedLinkFetcher({ EGRESS_PROXY: { fetch() {} } }), null);
});
test("private adapter sends authenticated single-hop request and verifies TLS peer", async () => {
  let count = 0;
  const fetcher = createVerifiedLinkFetcher(fakeEnv(async (url, opts) => {
    count++;
    assert.equal(url, "http://egress.internal/fetch");
    assert.equal(opts.headers.authorization, `Bearer ${token}`);
    assert.equal(opts.redirect, "manual");
    assert.equal(JSON.parse(opts.body).url, "https://example.com/");
    return new Response(JSON.stringify(payload()), { status: 200 });
  }));
  const response = await fetcher("https://example.com/");
  assert.equal(response.status, 200);
  assert.match(await response.text(), /public page/);
  assert.equal(count, 1);
});
test("missing, mismatched and unverified transport evidence fail closed", async () => {
  for (const data of [
    payload({ transport: null }),
    payload({ transport: { ...payload().transport, observedPeerIp: "127.0.0.1" } }),
    payload({ transport: { ...payload().transport, tlsAuthorized: false } }),
    payload({ transport: { ...payload().transport, tlsServername: "wrong.example" } }),
    payload({ bodyBase64: "bad?" })
  ]) {
    const fetcher = createVerifiedLinkFetcher(fakeEnv(async () =>
      new Response(JSON.stringify(data), { status: 200 })));
    await assert.rejects(() => fetcher("https://example.com/"));
  }
});
test("proxy 401 and 502 never fall back to global fetch", async () => {
  for (const status of [401, 502]) {
    const fetcher = createVerifiedLinkFetcher(fakeEnv(async () => new Response("", { status })));
    await assert.rejects(() => fetcher("https://example.com/"), /proxy_unavailable/);
  }
});

test("configured credentials do not activate reader without explicit opt-in", () => {
  for (const value of [undefined, false, true, "false", "TRUE", "1"]) {
    const env = fakeEnv(() => { throw Error("must not contact proxy"); });
    env.URL_READER_ENABLED = value;
    assert.equal(createVerifiedLinkFetcher(env), null);
  }
});

test("private-hop envelope rejects an oversized declared body before consuming it",async()=>{
  let pulled=0,cancelled=false;
  const body=new ReadableStream({pull(){pulled++;},cancel(){cancelled=true;}},{highWaterMark:0});
  const fetcher=createVerifiedLinkFetcher(fakeEnv(async()=>new Response(body,{
    headers:{"Content-Length":String(MAX_PROXY_RESPONSE_BYTES+1)}
  })));
  await assert.rejects(fetcher("https://example.com/"),/proxy_envelope_too_large/);
  assert.equal(pulled,0);assert.equal(cancelled,true);
});
test("private-hop streaming cap cannot be bypassed with a false small Content-Length",async()=>{
  let cancelled=false;
  const bytes=new TextEncoder().encode(" ".repeat(500001));
  const body=new ReadableStream({pull(c){c.enqueue(bytes);},cancel(){cancelled=true;}});
  const fetcher=createVerifiedLinkFetcher(fakeEnv(async()=>new Response(body,{
    headers:{"Content-Length":"1"}
  })));
  await assert.rejects(fetcher("https://example.com/"),/proxy_envelope_too_large/);
  assert.equal(cancelled,true);
});
test("caller abort bounds an uncooperative stalled envelope and cancellation",async()=>{
  let started,cancelled=false;
  const reading=new Promise(resolve=>{started=resolve;});
  const body=new ReadableStream({pull(){started();return new Promise(()=>{});},
    cancel(){cancelled=true;return new Promise(()=>{});}});
  const fetcher=createVerifiedLinkFetcher(fakeEnv(async()=>new Response(body)));
  const controller=new AbortController();
  const result=fetcher("https://example.com/",{signal:controller.signal});
  await reading;controller.abort();
  await assert.rejects(result,/proxy_request_aborted/);
  assert.equal(cancelled,true);
});
test("private-hop malformed JSON or UTF-8 never delivers content",async()=>{
  for(const body of ["{",new Uint8Array([0xc3,0x28])]){
    const fetcher=createVerifiedLinkFetcher(fakeEnv(async()=>new Response(body)));
    await assert.rejects(fetcher("https://example.com/"));
  }
});
