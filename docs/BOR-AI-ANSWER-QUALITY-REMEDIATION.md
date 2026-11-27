# BOR AI answer quality — first remediation (2026-11-26)

Base: production pilot evidence 1c1be46780f24aa391a87ef5d6bcbe4f55d5bd53. Production remains at v689 (legacy Tavily, dedicated OpenAI secret retained). This branch is not deployed.

Changes:
- Shared communication instruction explicitly requires coverage of all requested deliverables, appropriate depth, facts versus uncertainty, and no filler.
- Public search router must preserve every subquestion, constraint, source requirement and requested format in the sanitized standalone task. No raw unsanitized prompt is newly sent to OpenAI.
- Web search answer instructions demand a coverage check before finalization and explicit answers or evidence gaps. No extra provider request or higher reasoning/search context/token limit was introduced.
- Deduplicate citation URLs after removing only allowlisted UTM tracking keys. Credential-bearing URLs remain rejected before normalization; meaningful query selectors and fragments are preserved for live links.
- Link source panel is scoped to one message and replaced on repeated rendering; exact duplicate entries are skipped. Display title and domain instead of a long URL; inline numbering retained.
- Added a Node regression test and extended existing Playwright pilot regression test. Full Node and Playwright suites have not been executed in this session.

Executed focused checks (isolated JavaScript with actual changed web-search source and existing URL validator, injected mock classifier, fake D1 admission and mocked provider response; no network/model request from test code):
1. Classifier instruction asks for all subquestions.
2. Mock full sanitized question preserved.
3. Provider receives all subquestions from mock plan.
4. Completeness instruction included.
5. Existing token/tool/effort/context/store controls unchanged.
6. Cited fixture answer preserved.
7. UTM variants deduplicated; meaningful query selectors preserved; credential-bearing citation rejected.
8. Native citation marker deduplicated.
9. Exhausted fake admission prevents another provider call.
10. Nonpilot denied.

Frontend focused DOM-double test executed against actual changed appendSources function: two renders -> one link-source panel, duplicate entry -> one source, attachment panel preserved, compact title shown. This is not a browser test and does not prove the root cause of the screenshot's repeated panel.

These tests demonstrate code contracts and rendering behavior with mocks, not model answer quality, factual accuracy of a new live output, real D1 concurrency or full end-to-end coverage. New regression tests must be executed in a complete local checkout with Node >=22 and Playwright desktop/mobile (no GitHub Actions). No new paid inference, no production mutation or budget increase in this remediation.

Quality acceptance for the next evaluation:
- Multi-part public science: initial mass, additional mass, total, announcement date and technical cause; each answered or explicit evidence gap. Bennu fixture: NASA's 70.3 g earlier, 51.2 g poured, 121.6 g final (additional particles), 15 February 2024, two stuck fasteners/new tools. No incorrect claim that all earlier material was outside the head.
- General chat: multi-step explanation, constraints, no unrequested conclusion; user language maintained.
- Writing: produce complete requested artifact, not generic guidance.
- Follow-up: preserve relevant subject and explicit constraints without transmitting private data.
- Citation: each material claim has correct source; distinct meaningful URLs retained; no duplicate source panel after send, reload, regenerate or repeated renderer invocation.
- Simple question: concise, not unnecessarily expanded; complex question: substantial and complete.
- Compare blinded outputs against a reference rubric; do not claim parity with ChatGPT from mock tests alone.
- Billing: D1 recorded 1 admission / USD 0.26 reserved on Nov 26 UTC. Actual OpenAI invoice requires authorized project Usage/Spend dashboard evidence. Current connector cannot read billing. Do not infer exact cost from reservation. No reset or additional live pilot before approval and evaluation gate.
