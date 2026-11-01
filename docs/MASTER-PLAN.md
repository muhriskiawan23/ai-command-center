# BOR AI Ecosystem — Master Plan

**Version:** 0.1  
**Status:** Working baseline; founder approval required for material strategic changes  
**Last updated:** 2026-11-01

## 1. Vision

Build BOR AI into a sustainable technology business, beginning with a useful AI software product and validating real user needs before expanding into a broader ecosystem. A possible token project, `$BORAI`, is treated as a separate research track and must not be used as a substitute for product-market validation.

## 2. Two distinct workstreams

### Workstream A — BOR AI Platform

Current repository: `muhriskiawan23/ai-command-center`.

Near-term objectives:
- Make the current chat and multi-agent experience reliable, understandable, and secure.
- Fix high-impact risks before increasing public exposure.
- Improve observability, cost controls, error handling, and user experience.
- Establish repeatable tests and trustworthy capability claims.
- Validate user demand and potential business models before scaling.

### Workstream B — prospective $BORAI token

Near-term objectives:
- Research whether a token is necessary and what genuine utility it could provide.
- Compare chain options, technical complexity, legal/compliance exposure, security, liquidity, and ongoing costs.
- Model token supply/distribution scenarios only as clearly labelled drafts.
- Do not deploy, mint, sell, distribute, or promote a live token in this phase.

The platform can progress independently of the token. A token is not a prerequisite for building or monetizing the software product.

## 3. Founder constraints and operating principles

- Solo founder supported by AI partners.
- Approximately 2–4 hours per day available.
- Bootstrap-first; avoid spending until the need and expected value are clear.
- Prioritize small milestones that can be tested and demonstrated.
- Preserve founder control over accounts, code, domains, funds, signing keys, and decisions.
- Do not assume external services are free; check quotas, billing, and usage limits.

## 4. Product baseline

The repository README describes a Cloudflare Workers application using Workers AI, Cloudflare D1, a browser dashboard, Google sign-in, guest sessions, conversation history, and a multi-agent coordinator. The code currently defines Coordinator, Researcher, Analyst, Writer, Fact Checker, Strategist, Coder, Planner, Critic, and Summarizer roles.

The technical audit dated 2026-10-31 records an open High-severity exposure: public guest chat can trigger multiple model calls, while the current rate limit is not a global spend ceiling. It also records unresolved deployment-path ambiguity and missing server-side model time/cost budgets. See `docs/AUDIT-BOR-AI.md`.

## 5. Business model hypotheses — not yet validated

Potential directions to investigate:
- Free tier with explicit usage limits.
- Paid plans for higher usage or specialist workflows.
- Business/team plans if real demand emerges.
- Custom workflows or integrations only after user validation.

No pricing, revenue, conversion, or market-size claim is approved at this stage. Validate willingness to pay before building billing infrastructure.

## 6. Success principles

- Product reliability and user value before growth.
- Measured usage and feedback before monetization assumptions.
- Cost per successful task and abuse exposure tracked before public scale.
- Security and privacy reviewed before collecting sensitive data.
- Token necessity and legal feasibility established before any token launch decision.

## 7. Explicit non-goals for the current phase

- No production deployment initiated by this collaboration.
- No token contract deployment, minting, presale, airdrop, liquidity pool, listing, or token launch.
- No paid advertising or infrastructure commitments without founder approval.
- No claims of browsing, file execution, code execution, or external integrations in BOR AI until implemented and tested.
