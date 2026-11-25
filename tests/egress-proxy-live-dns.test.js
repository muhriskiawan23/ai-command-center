import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { fetchPinned } from "../tools/egress-proxy/pinned-transport.js";

const REBINDING_HOST = "7f000001.01010101.rbndr.us";

// Test-only independent DoH resolvers. Never used by production transport.
// Only fixed public test/control names are queried; no user data, no connection
// to an answer, no resolver error converted to a successful empty answer.
const DOH_ENDPOINTS = ["https://dns.google/resolve", "https://cloudflare-dns.com/dns-query"];
const DNS_TYPES = { resolveCname: 5, resolve4: 1, resolve6: 28 };
const FIXTURE_NAMES = new Set([REBINDING_HOST, "example.com"]);
const dnsError = code => Object.assign(new Error(code), { code });
const normalize = name => typeof name === "string" ? name.toLowerCase().replace(/\.$/, "") : "";
export function parseFixtureDns(data, name, type) {
  if (data?.TC !== false || !Array.isArray(data.Question) || data.Question.length !== 1 ||
      normalize(data.Question[0]?.name) !== name || data.Question[0]?.type !== type ||
      !Number.isInteger(data.Status)) throw dnsError("EBADRESP");
  if (data.Status !== 0) throw dnsError(data.Status === 2 ? "ESERVFAIL" : data.Status === 3 ? "ENOTFOUND" : "EBADRESP");
  if (data.Answer !== undefined && !Array.isArray(data.Answer)) throw dnsError("EBADRESP");
  const records = data.Answer || [];
  if (records.some(row => normalize(row?.name) !== name || row?.type !== type || typeof row.data !== "string" || !row.data)) throw dnsError("EBADRESP");
  if (!records.length) throw dnsError("ENODATA");
  return records.map(row => row.data);
}
function createFixtureResolver(index, mode) {
  if (mode === "system") return new dns.Resolver({ timeout: 1000, tries: 1 });
  if (mode !== "doh") throw dnsError("EBADMODE");
  const endpoint = DOH_ENDPOINTS[index % DOH_ENDPOINTS.length];
  const controller = new AbortController();
  const resolver = { cancel: () => controller.abort() };
  for (const [method,type] of Object.entries(DNS_TYPES)) {
    resolver[method] = async rawName => {
      const name = normalize(rawName);
      if (!FIXTURE_NAMES.has(name)) throw dnsError("EBADNAME");
      const url = new URL(endpoint);
      url.searchParams.set("name", name);
      url.searchParams.set("type", String(type));
      let response;
      try {
        response = await fetch(url, { headers: { Accept: "application/dns-json" }, redirect: "error",
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(1800)]) });
      } catch (error) {
        throw dnsError(error?.name === "TimeoutError" || error?.name === "AbortError" ? "ETIMEOUT" : "ECONNREFUSED");
      }
      if (!response.ok) throw dnsError("EHTTP");
      let data;
      try { data = await response.json(); } catch { throw dnsError("EBADRESP"); }
      return parseFixtureDns(data, name, type);
    };
  }
  return resolver;
}


test("real authoritative DNS rebinding answers are pinned or rejected before transport", {
  skip: process.env.BOR_AI_LIVE_DNS_REBINDING !== "1",
  timeout: 30_000
}, async () => {
  // DNS-only control separates general resolver failures from fixture-specific failure.
  // Never record resolver addresses or connect to either external destination.
  const mode = process.env.BOR_AI_DNS_TEST_RESOLVER || "system";
  const control = createFixtureResolver(0, mode);
  const controlEvidence = {};
  try {
    for (const method of ["resolveCname", "resolve4", "resolve6"]) {
      try {
        const answers = await control[method]("example.com");
        controlEvidence[method] = { outcome: "answered", count: answers.length };
      } catch (error) {
        controlEvidence[method] = { outcome: "error", code: /^E[A-Z0-9_]{1,30}$/.test(error?.code || "") ? error.code : "OTHER" };
      }
    }
  } finally { control.cancel(); }
  console.log("DNS-only control evidence:", JSON.stringify(controlEvidence));
  const deadline = Date.now() + 23_000;
  const resolverFailures = {};
  const transientFailures = {};
  let publicAccepted = 0;
  let privateRejected = 0;
  const selectedPeers = new Set();

  for (let attempt = 0; attempt < 32 && Date.now() < deadline - 250 && (!publicAccepted || !privateRejected); attempt++) {
    let transportCalls = 0;
    const observedAddresses = [];
    const underlyingResolver = createFixtureResolver(attempt, mode);
    const resolver = {};
    for (const method of ["resolveCname", "resolve4", "resolve6"]) {
      resolver[method] = async (...args) => {
        try {
          const answers = await underlyingResolver[method](...args);
          if (method === "resolve4" || method === "resolve6") observedAddresses.push(...answers);
          return answers;
        }
        catch (error) {
          const code = /^E[A-Z0-9_]{1,30}$/.test(error?.code || "") ? error.code : "OTHER";
          const key = method + ":" + code;
          resolverFailures[key] = (resolverFailures[key] || 0) + 1;
          throw error;
        }
      };
    }
    try {
      const result = await fetchPinned("http://" + REBINDING_HOST + "/", {
        resolver,
        timeoutMs: Math.min(5_000, deadline - Date.now()),
        request: async ({ peerIp }) => {
          transportCalls++;
          selectedPeers.add(peerIp);
          return { status: 204, headers: {}, body: Buffer.alloc(0) };
        }
      });
      publicAccepted++;
      assert.equal(result.peerIp, "1.1.1.1");
      assert.equal(transportCalls, 1);
    } catch (error) {
      if (["dns_timeout", "dns_cname_error", "dns_a_error", "dns_aaaa_error"].includes(error?.message)) {
        assert.equal(transportCalls, 0, "DNS failures must never reach transport");
        transientFailures[error.message] = (transientFailures[error.message] || 0) + 1;
      } else {
        if (error?.message !== "dns_unsafe_or_empty") throw error;
        assert.ok(observedAddresses.includes("127.0.0.1"),
          "unsafe/empty rejection alone is not proof of the fixture private DNS answer");
        privateRejected++;
        assert.equal(transportCalls, 0, "unsafe DNS answers must be rejected before transport starts");
      }
    } finally {
      underlyingResolver.cancel();
    }

    if (!publicAccepted || !privateRejected) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  const evidence = JSON.stringify({ resolverMode: mode, publicAccepted, privateRejected, transientFailures, resolverFailures, controlEvidence });
  console.log("External DNS-only evidence:", evidence);
  assert.ok(publicAccepted > 0, "missing public DNS evidence: " + evidence);
  assert.ok(privateRejected > 0, "missing private DNS evidence: " + evidence);
  assert.deepEqual([...selectedPeers], ["1.1.1.1"]);
});

// This parser contract runs offline even when the live proof is disabled.
test("fixture DoH parser rejects resolver failure, wrong question and ambiguous answers", () => {
 const name = REBINDING_HOST, type = 1;
 const base = { TC: false, Status: 0, Question: [{ name: name + ".", type }] };
 const answer = { name: name + ".", type, data: "1.1.1.1" };
 assert.deepEqual(parseFixtureDns({ ...base, Answer: [answer] },name,type),["1.1.1.1"]);
 assert.deepEqual(parseFixtureDns({ ...base, Answer: [{...answer,data:"127.0.0.1"}] },name,type),["127.0.0.1"]);
 for (const [data,code] of [
  [{...base,Status:2},"ESERVFAIL"], [{...base,Status:3},"ENOTFOUND"],
  [{...base,TC:true},"EBADRESP"], [{...base,Question:[{name:"example.com",type}]},"EBADRESP"],
  [{...base,Answer:[{...answer,type:5}]},"EBADRESP"], [{...base,Answer:[{...answer,name:"example.com"}]},"EBADRESP"],
  [base,"ENODATA"]
 ]) assert.throws(()=>parseFixtureDns(data,name,type),error=>error.code===code);
});
