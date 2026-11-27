# BOR AI — Answer Feedback

Signed-in users can rate each saved assistant answer as helpful or not helpful. A negative rating may include an optional free-text reason (maximum 500 characters).

## Data and privacy

- Feedback is attached to an assistant message and stored with its user and conversation IDs.
- The API verifies that the authenticated user owns both the conversation and the assistant message before accepting a rating.
- A unique constraint prevents duplicate feedback for the same account/message; submitting again updates the existing rating.
- Feedback is returned only when that same account loads its conversation.
- Deleting a message or conversation cascades to its feedback.
- Guest conversations are temporary and do not expose persistent feedback controls.
- An optional owner report at `/internal/feedback` shows aggregate ratings for the last 7 or 30 days. It includes the count of negative ratings with a reason. Chat contents, reason text and account identifiers are excluded.
- To enable the report, set `BOR_FEEDBACK_REPORT_OWNER_ID` to the exact existing `users.id` of the owner. The report checks the signed-in Google session and serves a 404 for every other account. Leaving the binding unset disables the report. The report uses the existing feedback table and does not require a migration.

## API

`POST /api/feedback` (same-origin authenticated session)

```json
{
  "conversationId": "conversation-id",
  "responseId": 123,
  "rating": "helpful",
  "reason": ""
}
```

Allowed ratings: `helpful` and `not_helpful`. Reason is optional and limited to 500 characters. Migration: `0007_answer_feedback.sql`.
