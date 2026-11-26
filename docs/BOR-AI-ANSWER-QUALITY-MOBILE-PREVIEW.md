# Mobile manual preview evidence — 26 November 2026

Candidate: 19e5be4ae3df5f736a4343bd891f7b670178b1d6.
Preview Worker: bor-ai-answer-quality-preview, version 39aa1732-7dc1-413b-8ee8-502918de3e8b, deployment 7a485ee6-5d7f-4463-b155-ef1000a3eb05. Seventeen candidate frontend assets, synthetic API responses, no external model credentials, no D1 bindings, no production changes.

Owner supplied two Android screenshots at approximately 14:45 and 14:47 WIB after sending the synthetic command "uji web search bennu". Screenshots demonstrate:
- Guest chat submission and rendered fixture response.
- Heading and bold text; three-row Markdown table with numerical right alignment fitting the visible mobile width.
- Inline numbered citation links visibly rendered.
- Exactly one visible web-source panel in the lower screenshot, showing two unique sources despite the preview returning a duplicate source entry.
- Compact article titles and publisher domain, and separate tool-activity panel.
- Composer remains visible below the response.

Manual visual smoke of these elements: PASS. Actual citation navigation, regenerate/reload/history, desktop viewport, authenticated session and full Playwright suite remain unverified. No live AI inference was performed; the synthetic answer is not evidence of improved model reasoning or ChatGPT parity. Preview API is not the production backend. Node regression evidence remains 749 passed, 0 failed, 1 intentionally skipped. Actual OpenAI invoice cost still unknown. Preserve production v689, Tavily, the dedicated key and exhausted pilot ledger until full release gate is satisfied. Do not enable another paid pilot without an approved budget.