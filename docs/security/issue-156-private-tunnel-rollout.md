# Issue #156 — Cloudflare Tunnel / Railway private transport rollout

Status: **DESIGN / NO-GO for production** (2026-11-12). This is a deployment plan, not proof of a working private route.

## Verified state

- [Cloudflare infrastructure preflight #43132087669](https://github.com/muhriskiawan23/ai-command-center/actions/runs/43132087669): active dedicated token; Tunnel inventory GET HTTP 200; Workers VPC Directory GET HTTP 200. **Write permissions have not been tested.**
- Railway production proxy service `61c2d6ef-beb9-4389-b7ff-a7ddb09a7df0`, project `3b63c1b0-7ef6-4461-a213-7a20aa87ecc0`, environment `4f87af1b-6241-43c6-9e6d-be0aabd3cf14`: Node HTTP service listens on port 10000, `EGRESS_PROXY_TOKEN` variable exists, `/health` exists. It currently has a **public Railway domain**; the private path is not yet present.
- `src/verified-egress.js` requires an `EGRESS_PROXY` binding with `.fetch()` and a Worker secret `EGRESS_PROXY_TOKEN`. The current Worker config has no binding. Do not enable the reader based on an HTTP 200 healthcheck.

## Proposed isolated topology

```text
BOR AI Worker (non-production first)
  -> Workers VPC Service binding EGRESS_PROXY
  -> Cloudflare Tunnel (private route, authenticated)
  -> cloudflared connector (Railway service, same project/environment)
  -> Railway internal DNS + port 10000
  -> pinned-transport Node proxy
  -> DNS vetting -> numeric-IP socket -> TLS SNI/hostname verification -> public origin
```

The connector must reach the Railway proxy over **Railway private networking**, not the existing public `*.up.railway.app` domain. Confirm Railway private DNS hostname from the actual deployed service before configuring the tunnel; never guess it. Tunnel ingress/service host and VPC Service host/port/TLS settings must match Cloudflare's documented runtime contract. A plain HTTP origin inside Railway is acceptable only if transport to the connector stays on the private network and Tunnel encapsulation is authenticated; otherwise require HTTPS with verified certificate.

## Execution order (do not skip)

1. Obtain owner approval for new Railway connector service, cost ceiling, region/jurisdiction, incident response owner, secret access/rotation, and public-domain removal after cutover.
2. Verify Cloudflare Tunnel **write** and VPC Directory **write** permissions using a tightly scoped, explicitly approved non-production creation operation; never assume GET 200 implies write permission.
3. Create one dedicated Cloudflare Tunnel and its credential/token without logging it. Configure the connector as a **separate Railway service**, not a second process in the existing proxy service. Inject the connector token as a sealed Railway variable if supported. Deploy in an isolated environment first.
4. Create the private Tunnel route to the verified Railway internal service endpoint; create a VPC Directory Service referencing the Tunnel and fixed backend host/port. Confirm the service health over the private route with no public fallback.
5. Add the `EGRESS_PROXY` VPC Service binding and `EGRESS_PROXY_TOKEN` Worker secret **only to a non-production Worker**. Do not use public URL proxying or an unpinned Worker fetch as a substitute.
6. Run `tools/egress-proxy/verify-hosted.mjs` and the negative tests from `docs/security/issue-156-production-release-gates.md` using controlled synthetic fixtures. Record origin-side selected and observed peer IP, TLS identity and original SNI without logging user URLs or page bodies.
7. Have a **different named reviewer** approve privacy/retention, export/delete/backup, and incident response. Keep issue #156 open until this review is signed.
8. Obtain separate production rollout approval, attach production binding and secret, remove the Railway public ingress (after proving no other dependency), smoke test and verify kill switch. Roll back by removing the binding; do not silently fall back to public fetch.

## Security invariants

- Railway public domain must **not** be the Tunnel backend.
- No proxy tokens, tunnel tokens, URL paths/query strings, page text or response bodies in GitHub Actions logs/artifacts.
- Reject unauthenticated requests at the proxy; treat a private Tunnel alone as insufficient authorization.
- Never report a VPC Service or Tunnel as working merely because the resource exists.
- If private route, origin peer-IP verification, TLS verification, or privacy review fails: **NO-GO** and URL Reader remains fail-closed.

## Open approval and evidence

- [ ] Owner approves connector service and operating cost ceiling
- [ ] Owner approves region/jurisdiction and operational owner
- [ ] Cloudflare write permission confirmed safely
- [ ] Cloudflare Tunnel connector deployed and healthy
- [ ] VPC Service private healthcheck succeeds
- [ ] Synthetic origin socket peer-IP/TLS/negative proof passes
- [ ] Independent privacy reviewer signs off
- [ ] Separate production enablement approval
