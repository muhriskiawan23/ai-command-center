# BOR AI workspace redesign — 18 November 2026

Implemented from the owner's approved desktop/mobile visual concept. The owner explicitly required the existing BOR AI logo to remain consistent. This branch retains the exact bytes of `logo-mark.svg`, SVG favicon, PNG app icons, ICO favicon and Apple touch icon; CI verifies their SHA-256 hashes.

## Result

- Light workspace by default with neutral surfaces and blue accents aligned to the original logo. Dark and device-following themes are available in Settings; the preference applies before stylesheet rendering and persists independently of chat data.
- Narrow, searchable history sidebar. Existing pin, archive, rename and delete operations are available in an accessible per-conversation disclosure; existing confirmation and authenticated server handlers remain in use.
- Compact Settings disclosure for appearance, language, usage, integrations, memory, archive and existing utility links. The server-verified account tier remains visible, with its explanation and catalog link in an expandable account-plan row. There is no client tier selector or new paid entitlement.
- Four simplified starting tasks retain the existing prompt payloads. The desktop layout uses four columns; mobile uses two. Menus, dialogs, messages, code blocks, footnotes and error surfaces follow the same theme.
- Composer attachments move into a plus disclosure. Specialist modes and the existing email-draft helper live in Tools. Existing PDF/CSV/Excel/PowerPoint/Word extraction and consent/send behavior remain intact.
- Disclosure controls work with pointer, keyboard, outside click and Escape. The active menu closes without dismissing the mobile navigation drawer. History actions remain accessible on touch devices.
- The original logo is used for navigation, welcome/loading, About and assistant avatars. The new icon sprite contains only utility icons, not a replacement brand mark.
- Health text now displays one readable status rather than a comma-joined pair of strings. Assistant/user action buttons are styled consistently.

## Scope and validation

This is a front-end change stacked on Draft PR #264 at `624d63a3f22d28e155b0f6ea08897d9da6ed7f98`. No provider credentials, billing flags, model calls, payment operations, remote migrations, security gates, production merges or deployments are part of the redesign.

The existing browser scenarios now open the Settings, Tools, account-plan and history disclosures before exercising the same underlying operations. Additional scenarios cover the original logo references, viewport boundaries, Escape/focus behavior, theme persistence without Guest-message storage, and real file-chooser reachability through the attachment menu.

Initial local verification: 184 browser scenarios passed across phone 390×844 and desktop 1280×800, 0 failed, 6 existing viewport-dependent skips. Full eight-viewport and exact-commit CI results must be checked before claiming complete verification. Local regression baseline after the redesign: 1,006 passed, 0 failed, 1 opt-in external-DNS skip.

For a synthetic local visual review, `npm run preview:workspace -- --port 5173` uses the existing ephemeral SQLite/stub-AI harness. Its Google UI is a non-authenticating stub; no account credentials or paid inference are used. This preview utility is not a production server and is not imported by the Worker. Real sign-in and paid release still depend on the existing server configuration and release checks.
