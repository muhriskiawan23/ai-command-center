FROM cloudflare/cloudflared:2026.10.5 AS connector
FROM node:22-bookworm-slim

WORKDIR /app
COPY --from=connector /usr/local/bin/cloudflared /usr/local/bin/cloudflared
COPY package.json ./
COPY tools/egress-proxy/pinned-transport.js tools/egress-proxy/pinned-transport.js
COPY tools/egress-proxy/cloud/server.mjs tools/egress-proxy/cloud/server.mjs
COPY tools/egress-proxy/cloud/start.sh tools/egress-proxy/cloud/start.sh

ENV NODE_ENV=production
USER node
EXPOSE 10000
CMD ["bash", "tools/egress-proxy/cloud/start.sh"]
