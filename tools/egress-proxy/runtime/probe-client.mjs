export async function waitForProbe(endpoint, {
  fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 10, report = () => {}
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    let response;
    try {
      response = await fetcher(endpoint, { method: "POST", signal: AbortSignal.timeout(5000), redirect: "error" });
    } catch {
      report("probe_readiness_network=unavailable");
    }
    if (response) {
      const status = response.status;
      await response.body?.cancel();
      report("probe_readiness_http_status=" + status);
      if (status === 401) return;
      if (![404, 502, 503, 530].includes(status)) throw Error("probe_endpoint_unexpected_status");
    }
    if (attempt + 1 < attempts) await wait(3000);
  }
  throw Error("probe_endpoint_not_ready");
}

const REASONS = new Set([
  "authentication_denial_failed", "unsafe_destination_denial_failed", "adapter_unavailable",
  "synthetic_origin_failed", "synthetic_content_failed", "proxy_unavailable",
  "proxy_security_proof_missing", "proxy_body_too_large", "invalid_proxy_body"
]);
export function safeProbeError(error) {
  const reason = REASONS.has(error?.message) ? error.message : "runtime_proof_failed";
  const proxyStatus = Number.isInteger(error?.proxyStatus) && error.proxyStatus >= 100 && error.proxyStatus <= 599 ? error.proxyStatus : null;
  return { reason, proxyStatus };
}
