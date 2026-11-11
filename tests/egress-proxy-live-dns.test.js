import test from "node:test";
import assert from "node:assert/strict";
import dns from "node:dns/promises";
import { fetchPinned } from "../tools/egress-proxy/pinned-transport.js";

const REBINDING_HOST = "7f000001.01010101.rbndr.us";

test("real authoritative DNS rebinding answers are pinned or rejected before transport", {
  timeout: 30_000
}, async () => {
  let publicAccepted = 0;
  let privateRejected = 0;
  const connectedPeers = new Set();

  for (let attempt = 0; attempt < 32 && (!publicAccepted || !privateRejected); attempt++) {
    let transportCalls = 0;
    try {
      const result = await fetchPinned("http://" + REBINDING_HOST + "/", {
        resolver: dns,
        timeoutMs: 5_000,
        request: async ({ peerIp }) => {
          transportCalls++;
          connectedPeers.add(peerIp);
          return { status: 204, headers: {}, body: Buffer.alloc(0) };
        }
      });
      publicAccepted++;
      assert.equal(result.peerIp, "1.1.1.1");
      assert.equal(transportCalls, 1);
    } catch (error) {
      if (error?.message !== "dns_unsafe_or_empty") throw error;
      privateRejected++;
      assert.equal(transportCalls, 0, "unsafe DNS answers must be rejected before transport starts");
    }

    if (!publicAccepted || !privateRejected) {
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }

  assert.ok(publicAccepted > 0, "the external rebinding service never returned the public test address");
  assert.ok(privateRejected > 0, "the external rebinding service never returned the private test address");
  assert.deepEqual([...connectedPeers], ["1.1.1.1"]);
});
