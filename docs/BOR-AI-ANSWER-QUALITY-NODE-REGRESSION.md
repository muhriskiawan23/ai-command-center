# Answer quality regression — full Node run (26 November 2026)

Owner supplied GitHub ZIP whose archive commit comment is 64e713418aeec99e63026623961056798296dcad. Extracted locally; Node 22.16.0. No GitHub Actions, external model calls or production changes.

Initial npm test: 749 tests, 744 passed, 4 failed, 1 skipped. All four failures were Web Search V2 tests. Diagnosed actual node:sqlite error "column index out of range": numbered SQLite parameters (?1, ?2, etc.) were treated as named placeholders, but the D1 harness spread positional arguments. Fixed only tests/e2e/harness.js and added direct regression in tests/web-search-v2-quality.test.js. Production SQL and quota logic unchanged.

After fix:
- Focused Web Search V2 Node tests: 6/6 passed (real local SQLite, stubbed classifier/provider). Includes concurrent atomic admissions, daily/monthly caps, nonpilot isolation, absent-migration fail closed, Tavily compatibility, kill switch, source deduplication and full task contract.
- npm run check: passed.
- npm test: 750 total, 749 passed, 0 failed, 1 skipped (real authoritative DNS rebinding test intentionally gated by BOR_AI_LIVE_DNS_REBINDING). Duration 21.3197 s. No external inference.
- Full Playwright suite: unavailable; npm ci --offline returned ENOTCACHED for playwright-core@1.56.1; ordinary npm ci failed EAI_AGAIN for registry.npmjs.org. A focused attempt using installed Playwright core and local Chromium failed at normal localhost navigation with net::ERR_BLOCKED_BY_ADMINISTRATOR. Do not bypass administrator restriction. No browser assertions ran. Browser release gate not met.
- 24-case bilingual benchmark structure is covered by the passing Node suite. No new actual model outputs, no proof of ChatGPT parity. Earlier Bennu baseline missed two requested fact groups; prompt and UI candidate changes are not yet deployed or validated live.
- Actual billing remains unverified: production D1 reservation USD 0.26 is not invoice cost. No additional charge initiated in this work.

Production remains unchanged by this session. Deployment and live quality validation remain gated on browser regression and fresh authorization of additional provider spend, with existing Web Search ledger and Tavily preserved.