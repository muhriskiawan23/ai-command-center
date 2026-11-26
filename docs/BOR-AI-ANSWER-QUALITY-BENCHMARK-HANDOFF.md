# Benchmark handoff and evidence — 26 November 2026

Candidate af5dd9b473576affbcc269b90b28e852d506ca82. Offline regression remains 765 passed, 0 failed, 1 optional DNS test skipped. This commit changes evaluation documentation only.

## Completed since final preview
- Owner Android screenshots at 15:53 WIB show the af5dd9b synthetic v2 preview displaying a partial-answer warning, a Markdown table, two numbered inline references, and exactly one visible sources panel containing two distinct NASA entries. Visual smoke passes for these elements. The tool activity section is collapsed; actual citation navigation, desktop, authenticated history and full browser regression remain unverified.
- Owner supplied OpenAI Usage screenshot for 26 November showing 8,921 total tokens, 1 request, and displayed total spend USD 0.01 in Default project. This is rounded project/dashboard aggregate evidence, consistent with the one prior pilot but not a request-level receipt or exact invoice. Production ledger previously recorded 260,000 micro USD reservation; these are different measurements.
- Owner explicitly approved a new aggregate reservation of USD 0.50, divided USD 0.24 text (six user turns plus search classifier) and USD 0.26 one web-search attempt. No new inference confirmed; budget not consumed by this session.
- Prior runner upload failed Cloudflare strict inheritance (10057). A follow-up upload attempt was blocked by safety checks. Do not retry or route around the block. Last readback confirmed live staging v35, kill switch true, production v689 unchanged, and zero rows for the new campaign. Existing pilot ledgers preserved.
- Curated reference answers are available in evaluation/answer-quality-reference.json. They were produced with knowledge of the rubric, not as an independently blinded ChatGPT benchmark run. NASA publications dated 15 February and 11 January 2024 were opened and checked for the exact facts. Reference JavaScript passed 10/10 direct assertions, including invalid inputs, sparse array, non-finite values and large magnitudes. The candidate was not re-run in this documentation-only step.
- evaluation/answer-quality-scorecard.json keeps all actual candidate scores null until genuine outputs are collected.

## Remaining gates
1. Resolve the supported deployment/access path for the isolated benchmark runner through the authorized environment. Do not expose raw credentials, replace keys unnecessarily, or change production. Respect the previous blocked operation and don't reattempt it through another route.
2. Verify exact candidate modules, protected execution, durable one-shot claim, aggregate reservation and no unauthorized provider/fallback calls before enabling inference. USD 0.50 is an approved reservation, not a guaranteed provider invoice cap.
3. Execute only the approved six scenarios (seven user turns, with one search classifier), capture actual provider receipts, compare answers against the reference and independently verify claims. Stop on a material failure. No rerun without reviewing budget and authorization.
4. Obtain full browser/authentication validation and explicit release decision; do not declare parity or deploy production from a synthetic smoke.
