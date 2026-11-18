# BOR AI workspace redesign — 18 November 2026

Implemented from the owner's approved desktop/mobile visual concept. The owner explicitly required the existing BOR AI logo to remain consistent. This branch retains the exact bytes of `logo-mark.svg`, SVG favicon, PNG app icons, ICO favicon and Apple touch icon; CI verifies their SHA-256 hashes.

## Result

- Light workspace by default with neutral surfaces and blue accents aligned to the original logo. Dark and device-following themes are available in Settings; the preference applies before stylesheet rendering and persists independently of chat data.
- Narrow, searchable history sidebar. Existing pin, archive, rename and delete operations are available in an accessible per-conversation disclosure; existing confirmation and authenticated server handlers remain in use.
- Compact Settings disclosure for appearance, language, usage, integrations, memory, archive and existing utility links. Account sign-in, daily usage and the existing pricing catalog link retain main-branch behavior. There is no new account-tier endpoint, tier selector or paid entitlement.
- Four simplified starting tasks retain the existing prompt payloads. The desktop layout uses four columns; mobile uses two. Menus, dialogs, messages, code blocks, footnotes and error surfaces follow the same theme.
- Composer attachments move into a plus disclosure. Specialist modes and the existing email-draft helper live in Tools. Existing PDF/CSV/Excel/PowerPoint/Word extraction and consent/send behavior remain intact.
- Disclosure controls work with pointer, keyboard, outside click and Escape. The active menu closes without dismissing the mobile navigation drawer. History actions remain accessible on touch devices.
- The original logo is used for navigation, welcome/loading, About and assistant avatars. The new icon sprite contains only utility icons, not a replacement brand mark.
- Health text now displays one readable status rather than a comma-joined pair of strings. Assistant/user action buttons are styled consistently.

## Scope and validation

This production release ports the UI-only commit from PR #268 onto main at `dd175021fd0881d996630ece62c85e3d39fdae62`. The draft paid-plan/media stack in PR #264 is excluded. No server source, billing flags, provider credentials, migrations, Worker configuration, pricing catalog or logo assets change.

The existing browser scenarios now open Settings, Tools and history disclosures before exercising the same operations. Additional scenarios cover the original logo references, viewport boundaries, Escape/focus behavior, theme persistence without Guest-message storage, and file-chooser reachability.

The source design passed 1,006 unit tests and 748 browser cases on its draft parent. Those counts are not release evidence for this main-based port: the release branch runs its own unit/build checks and full eight-viewport browser matrix before merge. Production delivery uses the existing Cloudflare Workers Builds integration; the manual production workflow is not modified and no D1 migrations are applied.

For a synthetic local visual review, `npm run preview:workspace -- --port 5173` uses the existing ephemeral SQLite/stub-AI harness. Its Google UI is a non-authenticating stub; no account credentials or paid inference are used. This preview utility is not a production server and is not imported by the Worker. Real sign-in and paid release still depend on the existing server configuration and release checks.
