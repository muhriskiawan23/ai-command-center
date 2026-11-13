# Tavily Extract — Provider Verification Request (BOR AI)

Status: **DRAFT — not sent**. URL Reader remains **NO-GO**, `URL_READER_ENABLED=false`. Do not send secrets, full user URLs, or personal information.

Recipient: support@tavily.com
Subject: Tavily Extract API security, data retention, and billing controls for BOR AI

Hello Tavily Support,

We are evaluating Tavily Extract (basic mode) for BOR AI, a consumer AI assistant. Before enabling user-submitted public URL extraction, please confirm the following for the Researcher plan and Extract API:

1. **SSRF and redirects:** Does Extract reject loopback, RFC1918, link-local, IPv6 ULA, cloud metadata, and other non-public destinations after DNS resolution? Are every redirect hop and DNS rebinding/re-resolution checked before connecting? What is the behavior for public URLs that redirect to private destinations?
2. **Data processing:** What are the precise retention periods for Extract input URLs, request logs, retrieved page content, and API responses? Are inputs or outputs used to train/improve models or services by default? Can we opt out? Please share applicable DPA, processing locations, and subprocessors for the Extract API.
3. **Billing:** With the Researcher free plan and pay-as-you-go disabled, are Extract requests reliably rejected once credits are exhausted, without overage charges? How are basic Extract credits rounded for batches of 1–5 URLs? Are failed requests/timeouts billable? Can we set per-key hard limits and alerts?
4. **Consent and product disclosure:** Is a user-facing notice that public URLs are transmitted to Tavily for extraction sufficient under your terms, or are there additional requirements for a consumer assistant?

Please link public documentation where possible. We will not run live SSRF probes or additional paid API calls to validate this.

Thank you,
BOR AI team

## Evidence reviewed (2026-11-13)

- Tavily privacy policy: https://www.tavily.com/privacy — allows certain query data uses for response improvement unless contracted otherwise; limited sharing with index providers; retention is purpose-based, not an Extract-specific fixed period.
- Tavily Trust Center: https://trust.tavily.com/ — publishes SOC 2 Type II / ISO 27001 and subprocessor information, but those alone do not establish Extract redirect/SSRF behavior.
- Tavily API terms FAQ: https://help.tavily.com/articles/3473422950-governing-terms-contracting-permissions — platform terms govern unless separate agreement.
- Tavily output storage FAQ: https://help.tavily.com/articles/1612400809-storing-caching-retaining-output — addresses **customer storage of returned results**, not Tavily's own retention of input URLs or logs.

## Release gate

Await written answers or provider documentation, review them against BOR AI's threat model and privacy notice, verify deployed Worker configuration and quota, then request explicit owner authorization. No live extraction or production flag change is approved by this document.
