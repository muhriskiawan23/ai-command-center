#!/usr/bin/env bash
# Isolated Cloudflare Builds runner helper, invoked ONLY from bor-ai-ci-only.
# Starts the repository's offline Worker/D1/AI-stub Playwright harness.
# Never deploys, queries real D1, calls live AI, or changes production.
set -euo pipefail

if [[ "${BOR_E2E_CI_ONLY:-}" != "1" ]]; then
  echo "E2E runner is opt-in and CI-only." >&2
  exit 1
fi
if [[ ! -f tests/e2e/harness.js || ! -f tests/e2e/playwright.config.js || ! -f package-lock.json ]]; then
  echo "Expected offline BOR AI E2E harness missing." >&2
  exit 1
fi

# Only allow known viewport names and existing E2E spec basenames. No arbitrary
# Playwright flags (including alternate configs, reporters, or --pass-with-no-tests).
args=()
while (( $# )); do
  case "$1" in
    --project)
      if (( $# < 2 )); then echo "Missing project name." >&2; exit 2; fi
      project="$2"; shift
      ;;
    --project=*) project="${1#--project=}" ;;
    *.spec.js)
      if [[ ! "$1" =~ ^[a-zA-Z0-9_-]+\.spec\.js$ || ! -f "tests/e2e/$1" ]]; then
        echo "Invalid E2E spec." >&2; exit 2
      fi
      args+=("$1"); shift; continue
      ;;
    *) echo "Unsupported E2E runner argument." >&2; exit 2 ;;
  esac
  case "$project" in
    phone-360x800|phone-375x812|phone-390x844|phone-412x915|phone-landscape-915x412|tablet-768x1024|tablet-landscape-1024x768|desktop-1280x800) args+=("--project=$project") ;;
    *) echo "Unknown E2E viewport." >&2; exit 2 ;;
  esac
  shift
done
if (( ${#args[@]} )); then
  printf 'E2E selection (partial matrix): %s\\n' "${args[*]}"
else
  echo "E2E selection: full configured matrix"
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
npx playwright test --config tests/e2e/playwright.config.js "${args[@]}"
