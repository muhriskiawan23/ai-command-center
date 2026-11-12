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
  "fixture_origin_invalid", "controlled_origin_failed", "expired_certificate_not_denied",
  "wrong_host_certificate_not_denied", "self_signed_certificate_not_denied",
  "private_redirect_not_denied", "response_limit_not_denied", "request_timeout_not_denied", "caller_abort_not_bounded",
  "authentication_denial_failed", "unsafe_destination_denial_failed", "adapter_unavailable",
  "synthetic_origin_failed", "synthetic_content_failed", "proxy_unavailable",
  "proxy_security_proof_missing", "proxy_body_too_large", "invalid_proxy_body"
]);
export function safeProbeError(error) {
  const reason = REASONS.has(error?.message) ? error.message : "runtime_proof_failed";
  const proxyStatus = Number.isInteger(error?.proxyStatus) && error.proxyStatus >= 100 && error.proxyStatus <= 599 ? error.proxyStatus : null;
  return { reason, proxyStatus };
}

// A newly created Worker can still serve a pre-secret version on another edge.
// Only retry endpoint startup statuses. A runtime/security 401 or 502 is final.
export async function fetchAuthenticatedProbe(endpoint, token, {
  fetcher = fetch, wait = ms => new Promise(resolve => setTimeout(resolve, ms)),
  attempts = 10, report = () => {}
} = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    const response = await fetcher(endpoint, {
      method: "POST", headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(90000), redirect: "error"
    });
    report("probe_authenticated_endpoint_http_status=" + response.status);
    if (![404, 503].includes(response.status)) return response;
    await response.body?.cancel();
    if (attempt + 1 < attempts) await wait(3000);
  }
  throw Error("probe_authenticated_endpoint_not_ready");
}
