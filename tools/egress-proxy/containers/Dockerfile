FROM node:22-bookworm-slim

# The test suite creates local TLS fixtures with OpenSSL. No network access is
# needed when the resulting image is executed.
RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY tools/egress-proxy/pinned-transport.js tools/egress-proxy/pinned-transport.js
COPY tests/egress-proxy*.test.js tests/

CMD ["node", "--test", "tests/egress-proxy.test.js", "tests/egress-proxy-hardening.test.js", "tests/egress-proxy-socket.integration.test.js", "tests/egress-proxy-body-socket.integration.test.js"]
