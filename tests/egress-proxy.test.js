import test from "node:test";
import assert from "node:assert/strict";
import {
  fetchPinned,
  isPublicAddress,
  resolveChain,
  MAX_RESPONSE_BYTES
} from "../tools/egress-proxy/pinned-transport.js";

const noData = () => Object.assign(new Error("no data"), { code: "ENODATA" });

test("public address classifier accepts global unicast and rejects special-use IPv4/IPv6", () => {
  assert.equal(isPublicAddress("8.8.8.8"), true);
  assert.equal(isPublicAddress("1.1.1.1"), true);
  assert.equal(isPublicAddress("2606:4700:4700::1111"), true);
  for (const ip of [
    "0.0.0.0", "10.0.0.1", "100.64.0.1", "127.0.0.1", "169.254.169.254",
    "172.16.0.1", "192.0.0.9", "192.0.0.10", "192.168.1.1", "192.31.196.1", "192.52.193.1", "192.175.48.1", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "fc00::1", "fe80::1", "ff02::1", "::ffff:8.8.8.8", "2001:db8::1", "2002::1", "2620:4f:8000::1"
  ]) assert.equal(isPublicAddress(ip), false, ip);
});

test("DNS CNAME chain is followed and all terminal A/AAAA answers are returned", async () => {
  const resolver = {
    resolveCname: async (host) => host === "alias.example" ? ["edge.example"] : Promise.reject(noData()),
    resolve4: async (host) => host === "edge.example" ? ["8.8.8.8"] : [],
    resolve6: async () => ["2606:4700:4700::1111"]
  };
  assert.deepEqual(await resolveChain("alias.example", resolver), ["8.8.8.8", "2606:4700:4700::1111"]);
});

test("DNS CNAME loops and mixed public/private answers fail closed", async () => {
  const loop = {
    resolveCname: async (host) => [host === "a.example" ? "b.example" : "a.example"],
    resolve4: async () => ["8.8.8.8"],
    resolve6: async () => []
  };
  await assert.rejects(resolveChain("a.example", loop), /dns_cname_loop/);

  const mixed = {
    resolveCname: async () => { throw noData(); },
    resolve4: async () => ["8.8.8.8", "10.0.0.7"],
    resolve6: async () => []
  };
  await assert.rejects(resolveChain("public.example", mixed), /dns_unsafe_or_empty/);
});

test("fetchPinned directs the request to one vetted numeric peer while retaining the original host", async () => {
  const resolver = {
    resolveCname: async () => { throw noData(); },
    resolve4: async () => ["8.8.8.8", "1.1.1.1"],
    resolve6: async () => []
  };
  let captured;
  const request = async (options) => {
    captured = options;
    return { status: 200, headers: { "content-type": "text/plain" }, body: Buffer.from("ok") };
  };
  const result = await fetchPinned("https://docs.example/path?q=1", { resolver, request });
  assert.equal(captured.host, "docs.example");
  assert.equal(captured.peerIp, "8.8.8.8");
  assert.equal(captured.url.hostname, "docs.example");
  assert.equal(result.peerIp, "8.8.8.8");
  assert.equal(result.redirect, false);
  assert.equal(result.body.toString(), "ok");
});

test("fetchPinned rejects credentials, custom ports, non-http schemes, and private IP literals before connect", async () => {
  let calls = 0;
  const request = async () => { calls++; throw new Error("must not connect"); };
  for (const url of [
    "http://user:pass@example.com/", "http://example.com:8080/", "file:///etc/passwd",
    "http://127.0.0.1/", "http://[::1]/"
  ]) await assert.rejects(fetchPinned(url, { request }), /rejected|unsupported|unsafe|invalid/);
  assert.equal(calls, 0);
});

test("redirect response is returned as one hop and is not followed by the transport", async () => {
  const resolver = {
    resolveCname: async () => { throw noData(); },
    resolve4: async () => ["8.8.8.8"],
    resolve6: async () => []
  };
  const result = await fetchPinned("http://public.example/start", {
    resolver,
    request: async () => ({ status: 302, headers: { location: "http://127.0.0.1/" }, body: Buffer.from("discard") })
  });
  assert.equal(result.status, 302);
  assert.equal(result.redirect, true);
  assert.equal(result.body.length, 0);
});

test("response byte limit is bounded by a fixed conservative default", () => {
  assert.equal(MAX_RESPONSE_BYTES, 1_000_000);
});


test("DNS resolver failures other than no-data fail closed", async () => {
  const cnameFailure = {
    resolveCname: async () => { throw Object.assign(new Error("servfail"), { code: "ESERVFAIL" }); },
    resolve4: async () => ["8.8.8.8"],
    resolve6: async () => []
  };
  await assert.rejects(resolveChain("unstable.example", cnameFailure), /dns_cname_error/);

  const addressFailure = {
    resolveCname: async () => { throw noData(); },
    resolve4: async () => { throw Object.assign(new Error("not found"), { code: "ENOTFOUND" }); },
    resolve6: async () => []
  };
  await assert.rejects(resolveChain("missing.example", addressFailure), /dns_a_error/);
});


test("CNAME depth is bounded and empty terminal DNS answers fail closed", async () => {
  const deep = {
    resolveCname: async (host) => {
      const n = Number(host.match(/^n(\d+)\.example$/)?.[1] || 0);
      return n <= 8 ? [`n${n + 1}.example`] : [];
    },
    resolve4: async () => ["8.8.8.8"],
    resolve6: async () => []
  };
  await assert.rejects(resolveChain("n0.example", deep), /dns_cname_depth/);

  const empty = {
    resolveCname: async () => { throw noData(); },
    resolve4: async () => [],
    resolve6: async () => []
  };
  await assert.rejects(resolveChain("empty.example", empty), /dns_unsafe_or_empty/);
});

test("each separate redirect hop resolves again and rejects a rebinding to a private address", async () => {
  let answer = "8.8.8.8";
  let connections = 0;
  const resolver = {
    resolveCname: async () => { throw noData(); },
    resolve4: async () => [answer],
    resolve6: async () => []
  };
  const request = async ({ peerIp }) => {
    connections++;
    return { status: 302, headers: { location: "http://other.example/next" }, body: Buffer.alloc(0), peerIp };
  };
  const first = await fetchPinned("http://public.example/start", { resolver, request });
  assert.equal(first.peerIp, "8.8.8.8");
  answer = "127.0.0.1";
  await assert.rejects(fetchPinned("http://other.example/next", { resolver, request }), /dns_unsafe_or_empty/);
  assert.equal(connections, 1);
});
