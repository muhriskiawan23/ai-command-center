# BOR AI — GPT-OSS and user-controlled tool workflows (2026-11-18)

## What this release does

1. **Reasoning model canary**: With `BOR_GPT_OSS_ENABLED=true` and an authenticated account, the Worker may use Cloudflare Workers AI `@cf/openai/gpt-oss-120b` for Coordinator, Analyst, Researcher, Writer and Coder. Other routes and guests remain on the existing Llama 3.3 baseline. This is an experimental model route, **not** verified ChatGPT/Claude-level quality.
2. **Hard spending gate**: Every candidate GPT-OSS invocation first reserves a conservatively high upper USD cost in the existing atomic D1 `daily_usage` table. Global cap `BOR_GPT_OSS_DAILY_USD_LIMIT=0.25` applies across users/isolates and at most two canary calls per user request. The guard includes estimated injected memory bytes plus a wrapper allowance. Missing DB/quota means Llama fallback, not unlimited spending.
3. **Actual source-based tool summaries**: BRO AI only labels web search or link extraction as successful when the configured Tavily/Brave provider returned usable results; links remain cited with their true source status. No fabricated Google browsing steps.
4. **Google Forms draft and consented creation**: BOR AI offers an eight-question feedback draft, a copy-ready Google Apps Script, and a *user-click-only* direct creation button using the official Google Forms API. Signed-in users explicitly confirm, approve the `forms.body` scope through Google OAuth, and can create one **unpublished** form in their Google account. Its real editor URL is returned only after the API confirms creation. Guest users use the Apps Script fallback. No automatic public sharing.

## Cost reference and limitations

Cloudflare's published per-million-token price for `gpt-oss-120b` is **US$0.35 input** and **US$0.75 output**, versus **US$0.293 input** and **US$2.253 output** for `llama-3.3-70b-instruct-fp8-fast`. See https://developers.cloudflare.com/workers-ai/platform/pricing/ and https://developers.cloudflare.com/workers-ai/models/gpt-oss-120b/ . These are usage fees, not proof of lower total invoice or superior answer quality. The reservation uses UTF-8 bytes as a conservative token ceiling, reserves per *attempt* including any hidden reasoning tokens up to max output, and intentionally does not refund billed/failed attempts. This can exhaust the budget before actual provider spending reaches the cap. Monitor invoices and response usage before increasing the ceiling. Do not raise caps automatically.

## Safety and release gates

- Run full CI including authenticated chat canary, timeout/cancel fallback, fee cap, strict output parsing, source citations, and mobile browser UI.
- Verify real model response envelope in **staging** using a small budget; test Indonesian/English CV/PDF summarization, calculations, coding, complex planning, model hallucination and security. Compare blinded against current Llama baseline before widening rollout.
- Verify latest Cloudflare AI usage and D1 migrations; preserve existing Tavily shared search and Extract quotas. Never bypass the public URL security checks.
- **No unattended external writes**: The optional direct Google Forms client uses an additional Google OAuth `forms.body` scope requested **only after the signed-in user clicks and confirms**. The browser sends its short-lived token directly to `forms.googleapis.com`, never to BOR AI's backend. `forms.create` uses `unpublished=true`, followed by `forms.batchUpdate` for the eight questions. The user must review and publish the form themselves. This needs enabled Google Forms API, correct OAuth consent setup and permitted JS origins; Google Sign-In by itself is insufficient. If OAuth/API isn't configured, use Apps Script. Live creation has **not** been verified against a real user Google account. https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/create and https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/batchUpdate .
- Never share private source, keys or hidden prompts in responses or logs; maintain existing confidentiality gates.
- Production deploy is a separate owner-authorized manual workflow; a successful merge alone does not deploy. Never announce a Google Form was created just because a script was generated.

## Suggested staged validation

- Step 1: PR tests + staging deploy with paid smokes disabled except a separately approved single synthetic GPT-OSS trial.
- Step 2: Confirm returned model ID, actual token usage, cost/margin, successful sourced search and timeout recovery.
- Step 3: Opt in a small authenticated canary group, then increase usage only after human-approved evidence; leave Guest on baseline.
- Step 4: Verify OAuth test users and consent screen in staging. Confirm one unpublished real form per user click and correct editor link before releasing direct creation widely. A script draft is not a live form.
