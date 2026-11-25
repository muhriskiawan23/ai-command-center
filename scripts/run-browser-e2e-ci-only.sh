#!/usr/bin/env bash
# Isolated Cloudflare Builds runner helper, invoked ONLY from bor-ai-ci-only.
# Starts the repository's offline Worker/D1/AI-stub Playwright harness.
# Never deploys, queries real D1, calls live AI, or changes production.
set -euo pipefail

if [[ "${BOR_E2E_CI_ONLY:-}" != "1" ]]; then
  echo "E2E runner is opt-in and CI-only." >&2
  exit 1
fi
if [[ ! -f tests/e2e/harness.js || ! -f playwright.config.js && ! -f tests/e2e/playwright.config.js ]]; then
  echo "Expected offline BOR AI E2E harness missing." >&2
  exit 1
fi

npm ci
npx playwright install --only-shell chromium

# The non-root Ubuntu 24.04 Workers Builds image lacks some Chromium .so files.
# Download only signed official Noble packages into a private temporary dir.
# DO NOT use sudo, trusted=yes, apt install, or persistent system mutations.
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
mkdir -p "$work/lists/partial" "$work/cache/archives/partial" "$work/download" "$work/libs"
printf 'deb http://archive.ubuntu.com/ubuntu noble main universe\n' > "$work/sources.list"
cat > "$work/apt.conf" <<EOF
Dir::State::lists "$work/lists";
Dir::Cache "$work/cache";
Dir::Etc::sourcelist "$work/sources.list";
Dir::Etc::sourceparts "-";
EOF
export APT_CONFIG="$work/apt.conf"
apt-get update
(
  cd "$work/download"
  apt-get download \
    libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 \
    libxcomposite1 libxdamage1 libxfixes3 libxrandr2 \
    libxkbcommon0 libasound2t64 libxi6
  for pkg in ./*.deb; do
    dpkg-deb -x "$pkg" "$work/libs"
  done
)
export LD_LIBRARY_PATH="$work/libs/usr/lib/x86_64-linux-gnu:${LD_LIBRARY_PATH:-}"
export CI=1
npx playwright test --config tests/e2e/playwright.config.js "$@"
