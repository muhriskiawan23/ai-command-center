# Web Search V2 operator preflight

26 November 2026 WIB. Previous checkpoint `198858cf81fe3fea154d99ae7d4d74eb42805fdf`.

- Staging v31 (`6107421e-6721-425c-8f4b-8555330ec3d3`) remained at 100% traffic on deployment `fbc6a8fa-3b39-443f-aceb-458666b9672f`. Kill switch on, search mode off, both smoke flags off, no temporary triggers or cron. Production version `c6dcf354-46c3-4772-9521-55f97cb2fb78` remained at 100%. No deployment or configuration changes were made.
- `BOR_LUNA_STAGING_TOKEN` exists as a Worker secret binding. The authorized execution environment has no usable operator token. No authenticated smoke request was sent. Existing regression and browser tests were reused.
- Read-only D1 checks returned nine historical search calls, US$0.228420 in the search ledger, and US$0.228947 for the completed base campaign `web-v2-responses-20261126-f` including router usage. There were zero smoke markers and zero running evaluations. New provider requests and charges were zero.
- [OpenAI Analytics Spend](https://platform.openai.com/analytics/spend) showed approximately US$0.13 for BOR AI Staging and US$0.13 in the breakdown for BOR AI Staging - Luna Test for 20–26 November 2026. Project and organization matched the Worker routing configuration. The visible web search tool line was US$0.11. These are rounded provider dashboard aggregates and cannot be matched to every historical request. Exact reconciliation remains open. Continue to budget against the higher D1 estimate, leaving US$0.271053 before the test. A single US$0.26 reservation would bring the estimate plus reservation to US$0.488947.

Owner action: make the existing `BOR_LUNA_STAGING_TOKEN` available to the authorized staging runner as a masked environment secret. Keep the value out of chat, command history and logs.

Once access is available, use the bounded one-shot `POST /smoke/web-search` with GPT-6 Luna, the existing dedicated provider key, and the base campaign above. Keep all other triggers off. Verify the D1 receipt, restore the original safe v31 configuration even on failure, and reconcile the new usage against OpenAI spend before closing the checkpoint. Retain the one-shot marker on failure or timeout.

[Previous deployment and rollback evidence](BOR-AI-WEB-SEARCH-V2-STAGING-V31.md)
