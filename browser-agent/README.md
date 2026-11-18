# BOR AI isolated Browser Run executor (staging beta)

This Worker is **private** (`workers_dev=false`) and accepts service-bound requests only, requiring an independent 32+-character `INTERNAL_BROWSER_AGENT_TOKEN` secret. It must not have a public route. **Never** pass user cookies, Google OAuth tokens, passwords, or payment data to it.

Uses Cloudflare Browser Run Playwright **1.3.6+** session `guardrails.allowedDomains` and a second network-routing policy. Only exact HTTPS hostnames listed in `BROWSER_ALLOWED_HOSTS` are accepted. Initial hosts are the public Playwright demo and example.com. Remote pages are untrusted. The browser is always closed in a finally block, does not persist cookies or downloads, blocks non-GET/HEAD requests, and **refuses high-risk named actions** like Submit, Delete, Pay, Publish and Login. Replaying a short plan uses a fresh session; it does not retain authenticated website state.

## Local/CI checks

`node --test tests/browser-automation-policy.test.js` at repository root verifies policy offline without paying for a browser. A separate GitHub workflow validates the isolated Worker bundle in dry-run mode.

## Private deployment prerequisites

Review allowed hosts, Cloudflare Browser Run plan/pricing and Cloudflare account security. Generate separate long random tokens and set `INTERNAL_BROWSER_AGENT_TOKEN` as a secret on this Worker and `BROWSER_AGENT_TOKEN` on the main BOR AI Worker (do not put values in git). Both must be the same secret. Deploy **this private Worker first**; then create a `BROWSER_AGENT` Service binding on the main Worker, keeping `BROWSER_AGENT_ENABLED=false` until end-to-end staging confirms policy, quotas, and browser behavior.

The private executor does **not** support arbitrary site automation or Google login. Google Forms direct creation via OAuth is a separate reviewed integration. External submissions/payments/delete/authentication are blocked at the policy and browser-network layers. An operator must explicitly enable the executor after security review; default flag is false. This is not equivalent to ChatGPT Work/Computer Use.

See docs/browser-automation-staging-20261119.md for release gates.
