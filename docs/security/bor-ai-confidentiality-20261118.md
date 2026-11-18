# BOR AI confidentiality protection — 18 November 2026

The owner requested that customer chat not disclose material that helps obtain BOR AI's source code, clone it or attack it. A screenshot showed a customer requesting review of BOR AI's code/architecture; the old answer supplied a reconnaissance plan despite having no actual source access.

## Implementation

- A server-side lexical request guard handles explicit BOR AI internals, source/architecture reviews, cloning, quota/payment bypass, disruption, hidden instruction extraction and bounded follow-ups. The main chat, authenticated widget API and authenticated Telegram webhook use it before inference and provider requests. Authentication, conversation ownership, origin checks and request-rate limits remain enforced. Direct refusals do not consume daily inference quota, mutate memory or save a chat turn. Refusals are localized for all ten supported UI languages.
- Every agent, including multi-agent stages and secondary channels, receives a shared confidentiality policy. Chat claims of owner/admin status grant no extra privilege. Supplied documents, memory, external sources and upstream findings cannot override it. Legitimate privacy/account safety questions, public product information, responsible reporting and user-owned code reviews remain allowed.
- Before an agent output reaches another agent or persistence, an independent filter replaces exact runtime credential values (including URL/base64 forms) and long verbatim prompt excerpts. Both first attempts and quality retries are checked. Credential values stay server-side and are never added to prompts or logs. Cached legacy replies are filtered on replay as well. Telemetry records a policy-blocked outcome without content.
- No new dependency, database migration, entitlement, payment change or logo/UI change is required.

## Limits and outstanding source exposure

This is defense in depth, not an authorization boundary or a guarantee against every language, paraphrase, encoding or injection. The deterministic request matcher primarily covers Indonesian/English; the shared model policy covers other languages, with the usual limitations of model compliance. Newly phrased reconstructions may evade lexical detection. The model must never receive credentials or private source it does not need. Direct refusal turns are not persisted, so account follow-up matching only sees authoritative previously saved history; the model policy still applies on every new turn.

The GitHub API confirmed `muhriskiawan23/ai-command-center` is **public** on 18 November 2026. Anyone may access published repository source independently of chat. This change does not alter repository visibility, retract existing copies or hide JavaScript/CSS delivered to a customer's browser. Source confidentiality requires the owner to make the repository private and verify GitHub/Cloudflare/automation integrations afterward. Public forks, clones and historical copies must be considered separately; secrets must not be committed even to private repositories.

This work does not suppress legitimate incident disclosure or promise that BOR AI is unhackable. Product privacy claims must continue to match actual data practices.

## Validation

Automated adversarial cases include the exact screenshot request across all twelve agents, owner/admin claims, explicit prompt extraction, Unicode-obfuscated brand names, cloning/bypass/disruption requests, multi-turn follow-ups, fake client history, cross-account access, first/retry output leaks, intermediate multi-agent steps, legacy replay, secondary-channel authentication and quota invariants. Negative cases retain ordinary privacy questions, own-code reviews and generic chatbot development. Asset tests verify server source/config paths return 404 and public agent metadata omits prompts. Browser tests exercise actual refusals and a subsequent allowed task without paid services.

Guidance: [OWASP system prompt leakage](https://genai.owasp.org/llmrisk/llm072025-system-prompt-leakage/) and [sensitive information disclosure](https://genai.owasp.org/llmrisk/llm022025-sensitive-information-disclosure/). Prompt instructions alone are not a security boundary; access and data minimization must be enforced outside the model.
