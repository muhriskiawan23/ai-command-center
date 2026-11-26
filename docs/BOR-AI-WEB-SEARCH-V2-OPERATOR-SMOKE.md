# Web Search V2 staging operator smoke

26 November 2026 WIB. Continuation of `5600464e3e92b7aeb735a8af592ab11412f90b2c`.

The staging operator token was rotated in Cloudflare Workers Secrets with the existing binding and permissions. An encrypted envelope delivered the new token to the temporary runner. The runner successfully authenticated while the smoke gate was disabled and removed its temporary credential material after the run.

Version 33 enabled the authenticated smoke for a four-minute maximum window. One request to `POST /smoke/web-search` completed over the existing GPT-6 Luna Responses API path. The Worker and upstream API both returned HTTP 200. D1 recorded one completed attempt, valid usage, and citation presence for the fixed Hamad International Airport query. No response body or secret was retained as evidence. Previous tests were not replayed.

| Evidence | Result |
| --- | --- |
| Provider request ID | `req_0189c3bc8b4e4fc9acb38215d9d24137` |
| Input / output tokens | 8,960 / 86, including 30 reasoning tokens in output |
| Web Search requests | 1 |
| Smoke cost from receipt | US$0.010939 estimated at published Standard rates |
| Campaign estimated total | US$0.239886 including US$0.228947 from prior usage |
| Campaign admission | US$0.488947 including the retained US$0.26 reservation, within the US$0.50 cap |

On a later refresh, OpenAI Analytics showed US$0.01 for BOR AI Staging on 26 November, with the same US$0.01 attributed to BOR AI Staging - Luna Test and to the web search tool calls line item. Project monthly spend rose from approximately US$0.13 to US$0.14. The posted tool fee matches the one request in D1. The remaining estimated US$0.000939 in token costs had no separate line item in the inspected daily view. Exact request-level invoice reconciliation remains pending. The estimate uses the usage recorded in D1. The receipt did not contain cache-write token counts. The D1 one-shot marker and full reservation remain in place.

Staging was restored to 100% version 32 (`0e7ba8cf-5cb9-4715-94db-f9a7797304b6`), deployment `2c8ed9ce-82a3-4350-9a61-b02b6c4325e7`. The rotated token remains in Cloudflare. The kill switch is on, search mode is off, both smoke flags are off, and the active version has no temporary triggers or cron. Production and Tavily were untouched.

[Machine-readable evidence](evidence/web-search-v2-operator-smoke-20261126.json) · [OpenAI daily spend](https://platform.openai.com/analytics/spend?range=today) · [OpenAI API pricing](https://developers.openai.com/api/docs/pricing)
