# Restoring a D1 database with account recovery enabled

`BOR_ACCOUNT_RECOVERY_KEY` is a Worker secret with 32 random bytes encoded as unpadded base64url. Store it separately from D1. Backups may contain hashes for old codes and sessions. A new key invalidates those hashes, including rows brought back by Time Travel. Google session lookup uses its existing hash. Recovery features also fail closed while `BOR_ACCOUNT_RECOVERY_ENABLED` is off or the key is missing.

## Before any production restore

1. Follow the existing [chat continuity procedure](CHAT-CONTINUITY-NONDESTRUCTIVE-RECOVERY.md) to preserve changes after the snapshot. Verify the target database and rollback bookmark.
2. Turn off account recovery on every Worker version receiving traffic. Verify issue and redeem are unavailable and an existing recovery session is rejected. Keep the current deployment, traffic split and prior version identifiers in the recovery record.
3. Set a fresh recovery key in a version with the feature still off. Use the managed secret binding. Verify active traffic reaches the version with the fresh key before restoring D1. Keep the new key out of source, command output and backups.

## Before reopening recovery

1. Verify the recovered D1 schema includes `account_recovery_codes` and the expected chat and session tables.
2. Bring up recovery only on versions using the fresh key. Verify remembered recovery codes and recovery-session cookies from before restore are rejected. Verify Google sign-in and chat history and create and redeem a fresh code on the test account.
3. If a check fails, turn recovery off. Use a rollback version with recovery disabled or with the current key. Keep the new key for all later recovery deployments. A version configured with the old key can make restored credentials valid again.

The old key must never be reused after restoring D1. Rotating it invalidates outstanding recovery codes and signs out sessions opened with those codes. Users can sign in with Google and create a fresh code.
