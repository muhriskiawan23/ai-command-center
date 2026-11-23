# BOR AI global marketing website

A **standalone static landing page** intended for `https://getborai.com/`. It is independent of the production chat Worker and has no login, payments, API calls, D1 bindings, Cloudflare Workers AI calls, or front-end JavaScript.

## Intended domains

| Domain | Responsibility | Deployment |
| --- | --- | --- |
| `https://getborai.com/` | Public English marketing site | New standalone Cloudflare Pages project (proposed) |
| `https://www.getborai.com/` | Optional redirect to apex, after validation | Pages/custom domain or existing zone rule |
| `https://app.getborai.com/` | Existing chatbot, Google sign-in, conversation history, and APIs | **Existing BOR AI Worker, unchanged** |

The landing page's CTA links to `https://app.getborai.com/`; it does **not** proxy chat requests or share app cookies.

## Contents

- `index.html`: product introduction, illustrative example prompts, user journeys, feature descriptions, Free/Basic/Pro status, FAQ, and app links
- `styles.css`: responsive dark visual design, reduced-motion and keyboard-focus support, no external font dependencies
- `logo-mark.svg`: local copy of the repository's existing BOR AI logo (avoid cross-host asset dependencies)
- `_headers`: static response security headers for Cloudflare Pages
- `robots.txt`, `sitemap.xml`: public indexing hints

Paid subscriptions are **not** represented as available: Basic $1.99 and Pro $6.99 are planned amounts; entitlements, credits, fees, terms, and checkout require a separate release. No endorsements, customer counts, performance figures, or unimplemented features are claimed.

## Local preview (no Cloudflare or API required)

From the repository root:

```sh
python3 -m http.server 8789 --directory marketing-site
```

Visit `http://localhost:8789/`. This is static and makes no paid provider calls. The `_headers` file takes effect only when served by a compatible Cloudflare Pages deployment.

Test source safeguards:

```sh
node --test tests/marketing-site.test.js
```

## Deployment plan: **manual, separate, not done by this PR**

1. Review content, branding, translations, accessibility, and legal policy requirements. Ensure global public preview / availability messages reflect actual service.
2. Create a separate Cloudflare Pages project from this repository, deployment branch `main` **only after review and merge**, no build command and output directory `marketing-site`. Keep the existing chat Worker configuration and the production `wrangler.jsonc` untouched.
3. Test the new project on its `*.pages.dev` preview URL. Check mobile layouts, anchors, headers, robots, and all CTAs; check that link navigation to `https://app.getborai.com/` works and that the app's Google auth/session/chat/history are unchanged.
4. Audit the actual active Cloudflare DNS/custom-domain/Worker route for `getborai.com`. Attach the apex to Pages **only** after an operator-authorized cutover plan. A conflicting Worker route or existing Pages custom domain may need an explicit controlled change; never remove or change the `app.getborai.com` binding.
5. After the apex change, verify HTTPS, apex canonical/redirect behavior, `app.getborai.com` login and chat continuity, CSP, mobile, SEO metadata, and rollback route to the previous apex target.
6. Configure a `www` redirect only after verifying zone and custom domain permissions. Optional future work: localized marketing pages, genuine product screenshots, support/legal/privacy links once reviewed.

This PR must **not** trigger production chat deploy, new D1 migrations, live paid calls, payment activation, or DNS changes.
