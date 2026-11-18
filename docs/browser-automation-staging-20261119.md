# BOR AI Browser Agent — isolated staging beta (2026-11-19)

## Goal and actual boundary

Use Cloudflare **Browser Run / Playwright** to open public JS-rendered websites, read them, identify user-facing controls and execute small, explicitly user-approved interactions. Not a general-purpose ChatGPT Work clone yet. The existing Tavily Search/Extract and GPT-OSS model remain separate.

Architecture:

- BOR AI main Worker: \`/api/browser/plan\` canonicalizes a requested plan, validates session and origin, and issues a **120-second, account-bound HMAC approval** for any click/fill/select. \`/api/browser/execute\` accepts the exact approved plan once, atomically consumes its nonce and reserves a **D1 per-user/global job quota**.
- Browser agent Worker: a **private service-binding-only Worker** using \`@cloudflare/playwright\`. It independently revalidates host and step schema, launches Browser Run with Cloudflare **guardrails.allowedDomains**, enforces a second request interceptor, opens the site, executes up to five approved actions, returns bounded text and elements, and closes browser/context in a \`finally\` block.
- UI: \`Alat → Browser beta\` shows the URL, visible page text, an element picker, a detailed step review, a separate explicit Execute click, and a manual handoff of the extracted text into chat.
- **Default off:** production \`BROWSER_AGENT_ENABLED=false\`, no \`BROWSER_AGENT\` binding in \`wrangler.jsonc\`. Browser agent staging itself is also \`BROWSER_EXECUTION_ENABLED=false\`. Merely merging or re-deploying main does not start browser sessions or incur browser charges.

## Security and financial limitations

- **Hard website allowlist**: exact HTTPS hostname only, no raw IP, local network, user:password URLs, non-default ports, cross-domain navigations or arbitrary schemes. Default permitted public test sites: \`demo.playwright.dev\`, \`example.com\`. Additional asset hostnames must be vetted, not supplied through the user's task.
- A Cloudflare Browser Run *session* network guardrail prevents unauthorized hostnames; a separate browser-context route denies all non-GET/HEAD requests, service workers, file downloads and third-party network requests outside the allowlist.
- **No persistent browser credentials or Google cookies**. This cannot operate an existing personal Google session. For a Google Forms task BOR AI already has a separate, consented official Google Forms API route.
- **Explicit user approval** before click, typing or selection; high-risk named controls are categorically rejected at this phase: passwords, credentials, OTP, login, payment, submit, delete, publish, share, upload, transfer, purchase, save, and similarly named actions. Websites can still have unforeseen effects from GET navigation or client-side JS; the allowlist must remain limited to reviewed sites.
- D1 job caps default **2 per account per UTC day and 10 globally**. Quota reservation is conservative and deliberately **not refunded after browser launch failures**, because browser time may already have been billed. Limits do not equate to a hard USD cap; monitor real Browser Run usage before widening service.
- Browser Run pricing (Cloudflare's published schedule): Free includes **10 browser minutes/day**, Workers Paid includes **10 browser hours/month**, then **US$0.09 per browser hour**; Browser Sessions may also incur concurrency charges if above plan allowance. https://developers.cloudflare.com/browser-run/pricing/
- Request/content caps and no arbitrary user JavaScript selectors/evaluation. Page content is untrusted. Do not use webpage instructions as system prompts. No CAPTCHA bypassing or credential stuffing.

## Staging deployment order (owner action, NOT automatically performed)

1. CI: run \`npm test\`, \`npm run check\`, \`npm run preview\`, and the Browser agent isolated-bundle GitHub workflow. No paid browser launches in CI.
2. Deploy ONLY the private disabled staging Worker through the GitHub workflow \`BOR AI isolated browser agent validation\` with \`deploy_staging=true\`, from \`main\`. Never expose a \`workers.dev\` URL or public route.
3. Privately configure a generated 32+ character shared secret as \`INTERNAL_BROWSER_AGENT_TOKEN\` in the isolated Worker and as \`BROWSER_AGENT_TOKEN\` in the main Worker, through Cloudflare secret management; never put values in GitHub, logs or screenshots.
4. After reviewing the Browser Run cost and domain policies, explicitly set \`BROWSER_EXECUTION_ENABLED=true\` in the **staging** agent config only.
5. Add the following **service binding** only to a separate reviewed main-Worker staging config once the private worker exists:

\`\`\`json
"services": [{ "binding": "BROWSER_AGENT", "service": "bor-ai-browser-agent-staging" }]
\`\`\`

6. Configure the primary Worker secret \`BROWSER_APPROVAL_SECRET\` (a different 32+ character value), then enable \`BROWSER_AGENT_ENABLED=true\` for **staging** only. The main production config intentionally keeps this off and has no service binding.
7. Test \`https://demo.playwright.dev/todomvc/\` with a signed-in test user: page inspection, one click and one fill, blocked requests, wrong-host redirects, duplicate token, expiry, consent cancellation, cost counters, and request timeout.
8. Add live browser reliability metrics and a human review of prompt-injection, unintended effects and provider charges. Widen hostname allowlist only after explicit owner approval and site-by-site risk review. Never activate on arbitrary hosts by default.

## Next phase (not implemented yet)

- Session persistence using Durable Objects with isolated per-user storage and explicit deletion.
- An AI planning layer that observes an accessibility snapshot and proposes multiple steps, with **every side-effect reviewed by the user**. This beta currently uses an interactive element picker, not autonomous multi-step AI planning.
- User-authenticated web account actions via scoped official OAuth APIs whenever available, and domain-specific permission contracts. Generic browser sessions must not collect passwords or bypass consent.
