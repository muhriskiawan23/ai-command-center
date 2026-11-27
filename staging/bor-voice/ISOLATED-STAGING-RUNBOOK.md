# BOR AI Voice isolated staging and release

## Isolated staging

- Worker: `bor-ai-voice-isolated`. This Worker owns separate SQLite Durable Objects for the legacy status and Primary ledger. The existing Voice staging Worker and the production app remain separate.
- Account configuration sets `VOICE_STAGING_ORIGIN` to the isolated HTTPS origin and `VOICE_STAGE_OWNER` to the exact lowercase owner email. Apply Google-only Cloudflare Access to `/api/voice/diagnostics` with one owner allow rule. The Worker also checks authenticated identity from the runtime request context. An unavailable identity or owner configuration denies access.
- The idle page and `GET /health` expose readiness only. The diagnostics route requires an authenticated owner and returns sanitized Primary ledger metadata with private, no-store caching. An empty staging ledger is expected before a pilot.
- The isolated build hard-disables the Primary gateway and the WebRTC session route. It receives neither an OpenAI key nor a production database, service binding, or ledger. The standing production readiness route continues to read the legacy Voice status over its existing binding.
- Build the isolated Worker from this source with the existing Wrangler workflow. Use the repository's compatible Wrangler 4 installation.

```sh
WRANGLER_SEND_METRICS=false wrangler deploy --config wrangler.voice-isolated.jsonc --dry-run
node --test staging/bor-voice/tests/*.test.mjs
```

## Acceptance sequence

1. Check the isolated landing page, `GET /health`, and `GET /api/voice/session/status`. Expect the inactive notice, `paid:false` and a readable isolated ledger. Check that both session routes deny a start.
2. Open the diagnostics path as a guest and verify the Access gate. Sign in with the authorized Google owner account. Expect HTTP 200, a private `no-store` response, and the sanitized Primary record list. Verify that a non-owner account is denied. Use a separate signed-out context for guest testing.
3. Resolve OpenAI case 21269168. Verify the actual project association and legacy end state using provider evidence or sufficient conservative exposure evidence. Obtain the maximum duration billed by the provider for the planned transport and account for any handshake charges. Preserve the original reservation and receipts. The app timer is a local shutdown safeguard.
4. Run one explicitly budgeted pilot with the owner on physical Android, then desktop. Record audio in both directions, user interruption, disconnect and recovery without a second allocation, a matching terminal event, and the final ledger entry. Exercise sourced search and image attachment separately if they are in the pilot scope. Record screenshots or response metadata privately without retaining raw audio, transcripts, tokens, or session dumps.
5. Confirm readiness, authorized login and ordinary chat against the measured baseline before promotion. Verify the release artifact, account scope, previous version ID, and rollback target immediately before deploying. Advance only when all acceptance checks pass.

## Monitoring and rollback

- Observe both the Worker deployment and provider usage during the pilot. Record start and close outcomes, unconfirmed reservations, timeouts, duplicate attempts, upstream HTTP failures, and finished usage. Verify that the confirmed receipt matches the reserved session. Record aggregate error counts and sanitized operational metadata.
- Pause admissions if there is a duplicate allocation, missing terminal usage, cost outside the approved envelope, unexpected authentication behavior, any production chat or login regression, or a provider error that makes session state ambiguous. Keep any unresolved reservation held. A successful health request alone cannot clear a failed pilot.
- To stop traffic in the isolated environment, disable its workers.dev route and leave preview URLs disabled. If a later release is active, first close paid admissions. Restore the previous verified application version only if the release changed production traffic. Recheck landing, health, login, and chat. Worker version rollback restores code and bindings for that version. Preserve the Durable Objects, migrations, reservations, and receipts for reconciliation.
- Escalate a stale reservation with its bounded time window and allowlisted diagnostics. Track case 21269168 in the existing support thread.
