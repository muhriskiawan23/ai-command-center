# BOR AI plugin capability audit

This audit separates BOR AI's working tools from connected services and from a future third-party plugin marketplace. A catalog card must not imply an action that the current backend cannot perform.

## Current capabilities

| Catalog entry | What works now | Limits that must be visible |
| --- | --- | --- |
| Web search | Search is triggered automatically for supported requests when a search provider is configured. Results are bounded and cited. | A missing provider key, provider error, or quota exhaustion means no live search. The model must not claim it searched. |
| File analysis | Browser-side extraction supports PDF, DOCX, XLSX, PPTX, CSV, JPG, PNG, and WEBP. Image understanding uses the separately configured vision path. | Office parsing is bounded and some embedded/non-text content is not extracted; limits are disclosed in upload handling. |
| Image tools | Image understanding can run on uploaded photos when vision is enabled. | Image generation/editing has its own paid queue, credits, storage, and API secret. It is disabled when any production requirement is missing. On the production check during this audit, `GET /api/images/config` returned `enabled: false`; do not present generation as active. |
| Email draft builder | Creates draft text in a BOR AI chat for the user to review. | It does not connect to Gmail or another mailbox, and it cannot send messages. |
| GitHub | OAuth connect/disconnect and a repository browser use the GitHub App installation grants. A read-only chat tool runtime is implemented for listing authorized repos, reviewing open issues, and reading text files. | Chat tools require `BOR_GITHUB_CHAT_TOOLS_ENABLED=true`, a signed-in user with GitHub connected, an explicit GitHub/repository request, and a reserved follow-up inference under a USD 0.10 default daily global cap. It cannot write to GitHub. The model calling feature is beta and has not been live-verified against the production account. |

The public `/api/plugins/capabilities` response reports configuration flags only. It does not return credentials or personal connection details. The catalog disables image generation when production setup is incomplete and distinguishes web-search configuration from a guaranteed successful search. Popular Google Drive, Gmail, Calendar, Slack, and Notion cards are marked coming soon; they are not connected.

## What the OpenAI screenshots represent

The ChatGPT plugin/app directory is a user-facing place to find and connect supported services. The OpenAI developer page is for building, validating, and preparing a plugin for publication; it does not make the directory's third-party services automatically available to BOR AI.

## Work needed for ChatGPT-style plugins

BOR AI has a bounded, gated tool-call loop for the first read-only GitHub tools. A reusable, user-facing plugin platform still needs:

1. A server-side registry with each plugin's typed actions, read/write classification, plan eligibility, configuration status, and user-visible permissions.
2. User-scoped authorization and encrypted credential storage for each service. Users must be able to review permissions and revoke access.
3. A server-side tool dispatcher that validates a model-proposed action against the registered schema, account grant, quota, and request budget before it runs.
4. Explicit confirmation and an audit record for actions that write or send data. Tool results return to the model as untrusted content.
5. Per-provider integration work, security review, tests, provider approval where required, and explicit cost limits.

Cloudflare lists function calling for the current Llama model, but the feature is beta. GitHub tool invocation remains disabled unless the runtime flag is set; production activation should follow a staging check with a connected account and a bounded cost budget. The follow-up inference budget is atomically reserved in D1 before the connected repository is read. Tool results are marked untrusted, and the first version has no write actions.

## Next safe rollout

1. Keep the capability catalog truthful and configuration-aware.
2. Verify the gated GitHub read-only tool flow in staging against a repository the connected account is authorized to access.
3. Add per-user plugin enablement, visible action activity, and an audit history before introducing write tools.
4. Add Google Drive/Docs read-only, then Gmail and Calendar with their OAuth scopes and provider review.
5. Add Slack and Notion after registering their provider apps and confirming user-level scopes.

The read-only dispatcher uses the existing GitHub OAuth connection and introduces no new database migration or provider secret. Tool calling adds model inference calls, so it must remain bounded and disabled until the owner enables it after a staging check.
