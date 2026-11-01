# BOR AI Ecosystem — Roadmap

**Status:** Initial planning baseline  
**Last updated:** 2026-11-01  
**Capacity assumption:** Solo founder, AI-assisted, approximately 2–4 hours/day.

This roadmap is milestone-based rather than a fixed calendar promise. Reprioritize when evidence, bugs, or founder decisions change.

## Phase 0 — Shared operating system

**Goal:** Make collaboration and project state transparent.

Deliverables:
- Shared AI collaboration protocol.
- Master plan, roadmap, status, decision log, and token research framework.
- Dedicated feature branch and review-before-merge workflow.

Acceptance:
- Claude and ChatGPT are instructed to update the same documents.
- Founder can identify approved decisions and current blockers.
- No unreviewed changes are merged to main.

## Phase 1 — Product baseline and reliability

**Goal:** Establish a trustworthy baseline of the existing platform.

Priority work:
1. Re-run the existing automated test suite and syntax checks in a controlled local environment.
2. Verify current main-branch state against the technical audit.
3. Triage the open High issue for guest/public inference cost exposure.
4. Decide and document the official production deployment path; do not deploy.
5. Add or plan server-side inference time/cost safeguards.
6. Review privacy, authentication, data isolation, error handling, and capability statements.

Acceptance:
- Test results are recorded with environment and date.
- High-severity risks have an approved mitigation plan.
- Deployment path is documented and remains manual/approval-gated.
- No unsupported feature claims remain.

## Phase 2 — User validation and product focus

**Goal:** Learn which users and workflows create repeatable value.

Deliverables:
- Define initial target user segments and top use cases.
- Conduct low-cost interviews or structured feedback sessions.
- Track activation, repeat use, task completion, failure rate, and cost per successful task where measurable.
- Prioritize improvements based on observed friction.

Acceptance:
- A small set of validated use cases and user problems.
- Clear evidence for what to build next.
- No scale-up based solely on vanity metrics.

## Phase 3 — Monetization readiness

**Goal:** Test a sustainable business model without premature complexity.

Deliverables:
- Cost model for inference, storage, operations, and support.
- Draft free/paid tier limits.
- Willingness-to-pay validation.
- Abuse and spend controls before opening access further.

Acceptance:
- Unit economics are based on measured usage and current provider pricing.
- Pricing hypotheses are tested with potential users.
- Founder approves any paid service or billing implementation.

## Phase 4 — $BORAI feasibility research

**Goal:** Decide whether a token is justified at all.

Deliverables:
- Utility and necessity assessment.
- Chain comparison and security model.
- Tokenomics scenarios with assumptions and sensitivity analysis.
- Legal, tax, consumer-protection, and regulatory issue list for qualified counsel.
- Ongoing operating cost and treasury/control model.

Acceptance:
- Clear written go/no-go recommendation.
- Token utility is tied to a real product/ecosystem need, not speculative marketing.
- No deployment, minting, sale, distribution, or launch occurs in this phase.

## Phase 5 — Controlled scale

Only after product reliability, user demand, unit economics, security, legal review, and founder approval. Scope and timing are intentionally undecided.

## Weekly working rhythm

With 2–4 hours/day:
- Reserve one short session for reviewing metrics, bugs, and decisions.
- Focus the remaining sessions on one highest-priority deliverable at a time.
- End every substantial Claude/ChatGPT work session with a status update and handoff.
- Keep at least one session per week for testing and review rather than adding features continuously.
