# GitHub App setup for BOR AI

This guide configures the per-user GitHub connection used by BOR AI. Each BOR AI user authorizes their own GitHub account; repository access is limited to repositories available through an installation of the BOR AI GitHub App.

## 1. Create the GitHub App

Open **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App**.

Use these values:

- **GitHub App name:** choose an available name, for example `BOR AI`.
- **Homepage URL:** `https://ai-command-center.muhriskiawan23.workers.dev`
- **Callback URL:** `https://ai-command-center.muhriskiawan23.workers.dev/api/github/callback`
- **Webhook:** not required for the current OAuth connection flow; leave it disabled unless a later feature explicitly needs it.
- **Expire user authorization tokens:** enable this so the OAuth flow can issue refresh tokens.
- **Request user authorization (OAuth) during installation:** enable this if the option is shown, so users can authorize the app while installing it.

For repository permissions, configure the minimum permissions required by the planned repository workflow:

- **Metadata:** Read-only (required by GitHub).
- **Contents:** Read and write (needed for reading files and the planned branch/file/commit workflow).
- **Pull requests:** Read and write (needed to inspect and create pull requests).

Do not grant Administration, Actions, or other permissions unless a separately reviewed feature requires them. Select **Only on this account** or the intended installation scope appropriate for the app owner. Save the app.

> The current connection code uses GitHub App user authorization and the authenticated user's app installations. Users must install the app on the account or organization that owns the repositories they want BOR AI to access. Repository selection can be limited to selected repositories during installation.

## 2. Collect the app credentials

From the GitHub App settings, copy:

- **Client ID**
- **Client Secret** (generate one if needed)

Do not paste either value into chat, commit them to the repository, or put them in browser-side code.

## 3. Generate the encryption key

Generate a random 32-byte key encoded as unpadded base64url. On a machine with OpenSSL:

```bash
openssl rand -base64 32 | tr '+/' '-_' | tr -d '='
```

Keep the result private. It is used by the Worker to encrypt GitHub access and refresh tokens before storing them in D1. Losing or changing this key makes previously stored encrypted tokens unreadable; users would need to disconnect and reconnect GitHub.

## 4. Add Cloudflare Worker secrets

In the Cloudflare dashboard, open **Workers & Pages → ai-command-center → Settings → Variables and Secrets**. Add the following as encrypted **Secrets** (not plain-text variables):

| Secret name | Value |
| --- | --- |
| `GITHUB_APP_CLIENT_ID` | GitHub App Client ID |
| `GITHUB_APP_CLIENT_SECRET` | GitHub App Client Secret |
| `GITHUB_APP_REDIRECT_URI` | `https://ai-command-center.muhriskiawan23.workers.dev/api/github/callback` |
| `GITHUB_TOKEN_ENCRYPTION_KEY` | The generated 32-byte base64url key |

Save the changes and deploy the Worker so the secrets are available to the production runtime. These are **Worker runtime secrets**; they are not GitHub Actions repository secrets.

## 5. Install the app and verify the connection

1. Open the GitHub App's **Install App** page and install it on the account or organization containing the repositories to be accessed.
2. Choose **All repositories** or, preferably, **Only select repositories** and select the repositories BOR AI should be allowed to access.
3. Sign in to BOR AI with Google.
4. Start the GitHub connection from the BOR AI interface when that control is available, or visit `/api/github/connect` while signed in.
5. Approve the GitHub authorization.
6. Verify the authenticated account with `GET /api/github/connection`.
7. Verify app installations with `GET /api/github/installations`, then list allowed repositories with `GET /api/github/repositories?installation_id=<installation_id>`.

The API endpoints require an active BOR AI sign-in session. Do not share session cookies or access tokens.

## Troubleshooting

- **503 — GitHub App belum dikonfigurasi:** one or more of the four Worker secrets are missing or not deployed.
- **401 — Masuk ke BOR AI terlebih dahulu:** sign in to BOR AI with Google first.
- **No installations returned:** install the GitHub App on the GitHub account or organization that owns the target repositories, then retry.
- **Repository list returns 403:** verify the installation ID belongs to the currently connected GitHub account and that the repository is selected in the installation settings.
- **OAuth callback error:** confirm the Callback URL in GitHub App settings exactly matches the Worker secret `GITHUB_APP_REDIRECT_URI`, including HTTPS and path.

## Security notes

- Never share secrets in chat, issues, pull requests, screenshots, or source control.
- Use selected-repository installation access where practical.
- The Worker stores encrypted OAuth credentials in D1; the encryption key remains a Worker secret.
- Disconnecting a GitHub account removes that user's stored connection from BOR AI. Also revoke the app authorization or uninstall the app from GitHub if access should be withdrawn at the GitHub side.
- Repository writes, pull-request creation, merging, and deployment must remain subject to explicit user approval in the BOR AI workflow.
