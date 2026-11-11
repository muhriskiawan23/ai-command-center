import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { fetchPinned } from "../tools/egress-proxy/pinned-transport.js";

const REBINDING_HOST = "7f000001.01010101.rbndr.us";

test("real authoritative DNS rebinding answers are pinned or rejected before transport", {
  skip: process.env.BOR_AI_LIVE_DNS_REBINDING !== "1",
  timeout: 30_000
}, async () => {
  // DNS-only control separates general resolver failures from fixture-specific failure.
  // Never record resolver addresses or connect to either external destination.
  const control = new dns.Resolver({ timeout: 1_000, tries: 1 });
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
    const underlyingResolver = new dns.Resolver({ timeout: 1_000, tries: 1 });
    const resolver = {};
    for (const method of ["resolveCname", "resolve4", "resolve6"]) {
      resolver[method] = async (...args) => {
        try { return await underlyingResolver[method](...args); }
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

  const evidence = JSON.stringify({ publicAccepted, privateRejected, transientFailures, resolverFailures, controlEvidence });
  console.log("External DNS-only evidence:", evidence);
  assert.ok(publicAccepted > 0, "missing public DNS evidence: " + evidence);
  assert.ok(privateRejected > 0, "missing private DNS evidence: " + evidence);
  assert.deepEqual([...selectedPeers], ["1.1.1.1"]);
});
