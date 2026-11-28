# BOR AI Railway Serverless URL Reader — release gate

Date: 2026-11-28. Scope: isolated staging; production not changed.

## Verified evidence

- Railway deployment 141261f5-c804-41f9-8625-3d5607634d05, pinned to 8d9077bbc73305f097f16fec926e512f00853e52, SUCCESS; replica online. Startup logs report health, missing-auth rejection, private IP rejection, public HTTPS with socket/TLS evidence: all true. These are local-to-container tests, not Worker-to-Railway E2E evidence.
- Staging service has no public domain, serverless enabled, 0.25 vCPU and 0.25 GB configured limits, no crash restart, 1200s test timeout. Start command updated for the next deployment to remove TUNNEL_TOKEN from the Node process environment. The existing deployment is not redeployed for this change.
- The dedicated Cloudflare probe bor-ai-railway-egress-probe already has a private vpc_service binding and proxy/probe secret bindings, but its workers.dev subdomain is disabled. The staging tunnel is down, zero connections. These credentials are not read or copied.
- Live production Worker ai-command-center reports URL_READER_ENABLED=true, URL_READER_PROVIDER=tavily, TAVILY_EXTRACT_DAILY_URL_LIMIT=8, SEARCH_PROVIDER=tavily. Repository main configuration reports false/0 for reader enable/extraction limit. This is observed configuration drift; do not deploy main or silently reconcile in this task.
- Railway Free documentation specifies $1 monthly resource allowance and serverless sleep. Account plan, remaining allowance and hard spending cap not verified by available connector. Resource metrics are not a billing balance.

## Release decision

No cutover. The existing architecture decision docs/security/issue-156-egress-architecture.md requires private authenticated ingress via VPC Service, hosted socket/TLS/redirect/rebinding proof and independent privacy/retention signoff. The tunnel-free alternative exposes a different trust boundary if a public domain is provisioned, even with a bearer token. It must not be treated as a drop-in production substitute. Do not enable a public arbitrary-URL fetch endpoint before documented security approval and budget protection.

## Remaining acceptance gates

1. Confirm workspace Free allocation and hard zero-overage cap. Document hosting jurisdiction, retention, secret rotation, and abuse/budget limits. In-memory per-process quotas reset on restart and are not a monthly budget guard.
2. Choose either the existing private VPC architecture with a sustainable always-reachable connector, or review and explicitly approve a fixed HTTPS origin with authenticated server-to-server ingress, abuse protection and durable budget gating. No user URL may control proxy origin; no direct fetch fallback. Independent security/privacy review required.
3. Test authenticated Worker-to-Railway HTTPS/transport, negative authorization, actual pinned peer and original-host TLS, redirect and mixed DNS rejection, response/time limits, idle sleep and cold wake (where applicable), and realistic bounded resource usage. Keep credentials out of logs and Git.
4. Reconcile deployed production versus source configuration with an approved narrow diff, preserve rollback, perform a gated production smoke, then migrate URL Reader only. Tavily Search remains a separate provider decision. Do not remove Tavily before the replacement is verified.

Evidence references: https://railway.com/project/fb55adf4-2125-41ad-9a99-c88f8ca1f2dc ; https://docs.railway.com/pricing/free-plan ; docs/security/issue-156-egress-architecture.md.
