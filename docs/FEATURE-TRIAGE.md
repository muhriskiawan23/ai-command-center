# Feature wish-list triage (Stage 10)

Source: the founder's list of 17 candidate features. Status is stated by evidence, not by intent.
"Done" means implemented AND covered by automated tests with a stubbed model; behavior on the real model is called out separately.

| # | Feature | Status | What exists / what is missing |
|---|---|---|---|
| 1 | Emotion recognition | **Done (prompt-level only)** | Every agent gets COMMUNICATION RULES: notice emotional cues in the current message, acknowledge briefly, adapt tone, never diagnose, safety message with emergency services (Indonesia: 112) for self-harm/violence. No classifier, nothing is stored (test: no emotion/mood columns exist). Real-model behavior **untested**. |
| 2 | Multi-language | **Done (rule), quality unverified** | Rule: answer in the language of the user's latest message. As far as known, the model's officially supported languages do not list Indonesian or regional languages; quality there is **untested** and should be evaluated before promising it. |
| 3 | Database integration | **Not done — needs decision** | "More, up-to-date information" means either a search/news API (key, cost, legal terms) or retrieval over curated documents (e.g. Cloudflare Vectorize/AutoRAG). Which data sources? |
| 4 | Learning from interactions | **Done as opt-in memory** | The hosted model cannot be retrained live, so BOR AI offers explicit user memory (Memori): OFF by default, signed-in accounts only, only what the user asks to remember (panel or chat "ingat bahwa ..."), max 30 items x 200 chars, sensitive-data filter (heuristic), view/delete one/delete all/switch off. Nothing is inferred automatically. Real-model use of the memory is **untested**. |
| 5 | Context recognition | **Done** | Conversation history window (12 messages / 8,000 chars), plus a rule to ask one clarifying question instead of guessing. |
| 6 | Q&A | **Exists** | All modes; limited to model knowledge + links typed by the user. |
| 7 | Text analysis | **Done** | New mode "Text Analyst": summary, key points, sentiment with evidence, entities, checkable claims, advice; also works on `<web_page>` content. |
| 8 | Entity recognition | **Done (from the given text)** | Inside Text Analyst: entities listed as written with their role. Background about an entity is limited to model training knowledge, labelled "Pengetahuan umum (bisa usang)"; no live lookups; no inference of sensitive traits about named people. |
| 9 | Alerts about trending topics | **Not done — later** | Needs a scheduler (Cron Triggers), a data source, a delivery channel (email/push) and user consent. |
| 10 | Content generation | **Exists** | Writer and Coordinator modes. |
| 11 | Calendar / email / social integration | **Planned — see docs/INTEGRATIONS-PLAN.md** | One connector at a time; needs founder-owned accounts/keys, per-user OAuth and a security review for each. |
| 12 | Translation | **Done** | New mode "Translator" (short translations are allowed by the quality gate; other specialists stay strict). |
| 13 | Using images | **Not done — later** | Needs a vision-capable model (availability on the platform **not verified**), upload UI, size limits and moderation. |
| 14 | History-based recommendations | **Done via #4 (explicit memory only)** | Plus the conversation history window; no automatic profiling. |
| 15 | Habit recognition | **Not recommended** | Automatic behavioral profiling without explicit opt-in is a privacy risk; if wanted, fold it into #4 as explicit, user-visible preferences only. |
| 16 | Preference recognition | **Done via #4** | Only explicit, user-confirmed preferences. |
| 17 | Environment recognition | **Not recommended now** | Needs location/sensor permissions; a weather lookup could come later with explicit permission and an API. |

## Decisions requested
1. Integrations: which first and who creates the accounts/keys (see `docs/INTEGRATIONS-PLAN.md`).
2. Data sources for #3 (search API vs curated documents) and who pays for them.
3. Whether to pay for a stronger model (also needed for dependable tool calling).
