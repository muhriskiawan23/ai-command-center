# Google Search Grounding staging validation

26 November 2026 WIB. Previous checkpoint `df401d38d38f89adc54d42a3a4ba970890e375b2`.

## Eligibility and cost

Google AI Studio showed BOR AI Staging as Free tier with no billing account attached. Google lists `gemini-2.5-flash` and `gemini-2.5-flash-lite` as Search Grounding capable and publishes a shared allowance of up to 500 grounded prompts per day at no charge for the Free Tier. Actual availability and limits are project- and endpoint-specific. Google's terms classify Gemini API Grounding as a Paid Service and Google AI Studio Grounding as an Unpaid Service. Live acceptance on this project's Interactions API key was not verified. No billing configuration changed and no completed Gemini API usage or new charge was observed. Request-level billing reconciliation was unavailable.

## Evidence

- **Google integration simulations: 3 passed.** Eligible account failover after a synthetic OpenAI failure, rejection of collection-only results for a strict city query, and separation of transient Grounding results from saved history.
- **Browser E2E with mock providers: 4 passed** (360×800 phone and 1280×800 desktop). Checked clickable citations, display alongside the original suggestions in an opaque sandbox, and withholding the grounded answer when the suggestion markup is unsafe. The unrelated OCR CDN request failed in the browser; the search checks passed.
- **Staging live probe: no provider receipt.** The bounded Cloudflare Cron probe on v36 produced no D1 claim before removal. The scoped HTTPS probe on v37 timed out at the unauthenticated preflight, before the runner sent its credential. The approval reviewer blocked the v38 retry because another live trigger could duplicate provider usage or cost. Temporary runner tokens were removed. Final D1 inspection showed zero Google probe claims and the existing OpenAI ledger was identical to the preflight (10 calls, 488420 reserved microdollars).
- **Official Google AI Studio test:** One public synthetic prompt about the museum housing the Mona Lisa, with Search Grounding enabled and no API key selected, returned `permission denied` on `gemini-4-hydrogen`. This confirms the playground rejection only. The staging key, live citations and live Application failover remain unverified.

## Final configuration

Staging is back at 100% v35 (`2b99a156-92d6-4ebb-bfa4-02a7cc9efe6a`), deployment `7ae39a78-e7b6-4522-840a-68fc632a67b7`. Kill switch enabled, search mode off, both smoke flags off, no cron and no live probe route. The Gemini secret remains bound. Production remains at its prior version. Tavily and GPT-6 Luna were untouched. No historical OpenAI live test was replayed.

Keep Google failover disabled pending a single successful Grounding response and its price/eligibility verification on the existing project. The successful mock tests cover failover wiring and defensive rendering only.

[Projects and billing tier](https://aistudio.google.com/projects) · [Grounding model documentation](https://ai.google.dev/gemini-api/docs/google-search) · [Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing) · [Gemini API terms](https://ai.google.dev/gemini-api/terms)
