#!/usr/bin/env bash
set -euo pipefail
: "${TUNNEL_TOKEN:?Dedicated staging tunnel token required}"
: "${EGRESS_PROXY_TOKEN:?Staging egress token required}"

proxy_pid=
tunnel_pid=
stop_children() {
  if [[ -n "$proxy_pid" ]]; then kill "$proxy_pid" 2>/dev/null || true; fi
  if [[ -n "$tunnel_pid" ]]; then kill "$tunnel_pid" 2>/dev/null || true; fi
  wait || true
}
trap stop_children EXIT
trap 'exit 0' TERM INT

env -u TUNNEL_TOKEN node tools/egress-proxy/cloud/server.mjs &
proxy_pid=$!
env -u EGRESS_PROXY_TOKEN cloudflared tunnel --no-autoupdate --edge-ip-version 4 --protocol http2 run >/dev/null 2>&1 &
tunnel_pid=$!

# A healthy public listener alone cannot mask an exited private connector.
wait -n "$proxy_pid" "$tunnel_pid" || true
printf '%s\n' 'Staging egress process exited.' >&2
exit 1
