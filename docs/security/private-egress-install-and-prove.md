# Install existing Termux proxy token without disclosure

The production adapter now requires `URL_READER_ENABLED="true"` explicitly.
The checked-in production value is `"false"`. Installing credentials alone must
never activate URL reading. Do not manually install the Worker secret before
the OFF guard is deployed: older versions activate when credentials exist.

## One owner-side handoff

The connected GitHub tool can read runtime job logs and rerun jobs, but cannot
write repository secrets or dispatch a new workflow. The token exists only on
the owner's Termux device. Do not paste it in chat, an issue, a workflow input,
or a command argument. Keep the existing proxy and Cloudflare Tunnel running.
After this change is merged, run in Termux with GitHub CLI authenticated:

```sh
cd ~/ai-command-center
git pull --ff-only origin main
gh secret set EGRESS_PROXY_TOKEN --repo muhriskiawan23/ai-command-center < .egress-token
gh workflow run private-egress-install-and-prove.yml --repo muhriskiawan23/ai-command-center --ref main
```

If `gh` is unavailable, install it with `pkg install gh`; authenticate using
`gh auth login` and its device flow. Never send the login code or token in chat.
An existing `production` environment secret of the same name takes precedence;
ensure it is the same existing Termux token rather than introducing a second value.
No tunnel token changes are required.

## Automated operations

The main-only workflow validates credential presence, runs tests, deploys the
OFF guard, verifies Cloudflare deployed settings and a single 100% deployment,
then pipes the repository secret to Wrangler stdin. CLI output and raw API
bodies are never printed or uploaded. It rechecks OFF, secret-name metadata,
and the exact VPC Service binding after secret installation.

A unique temporary Worker reuses that private VPC Service. Its only authorized
operation is a fixed synthetic test; callers cannot supply a destination. It
checks missing/incorrect proxy auth, IPv4/IPv6 loopback and metadata rejection,
and reads example.com through the production adapter with peer-IP equality and
original-host TLS verification. It reports booleans, never URLs, bodies or tokens.
The workflow deletes that Worker in `finally`; a cleanup failure fails the run.
A cancelled or forcibly terminated runner may leave the run-specific Worker;
remove it manually if cleanup did not report success. Its endpoint stays authenticated.

A passing run proves only these bounded runtime checks. It does not establish
all DNS rebinding, mixed DNS/CNAME, redirect, invalid-certificate, timeout,
body-limit, independent privacy/retention or operational release gates.
URL Reader stays OFF even after this run passes. Activation is a separate
reviewed configuration change only after all required evidence exists.

## Evidence at preparation

Runtime readiness run 43212823228, rerun on 2026-11-12 UTC, still reported
`vpc_binding_config=verified` and `egress_proxy_token_secret=missing`.
No end-to-end success or production secret installation is claimed by this document.
