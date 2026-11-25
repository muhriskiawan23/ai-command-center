#!/usr/bin/env bash
# Cloudflare Workers Builds browser E2E only; no sudo, remote D1, or Worker deployment.
set -euo pipefail
workspace="$PWD/.bor-ci-browser-libs"
mkdir -p "$workspace/lists/partial" "$workspace/packages" "$workspace/overlay"
echo "BOR CI: downloading official Ubuntu browser libraries without root"
apt_opts=(-o Debug::NoLocking=1 -o APT::Sandbox::User="$(id -un)" -o Dir::State::lists="$workspace/lists" -o Dir::Cache::archives="$workspace/packages")
apt-get "${apt_opts[@]}" update -qq
cd "$workspace/packages"
apt-get "${apt_opts[@]}" download libatk1.0-0t64 libatk-bridge2.0-0t64 libatspi2.0-0t64 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libxkbcommon0 libasound2t64 libxi6
cd - >/dev/null
for package in "$workspace"/packages/*.deb; do dpkg-deb -x "$package" "$workspace/overlay"; done
export LD_LIBRARY_PATH="$workspace/overlay/usr/lib/x86_64-linux-gnu${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
echo "BOR CI: executing synthetic browser E2E; no external AI or payment requests"
export CI=1
npm run test:e2e
