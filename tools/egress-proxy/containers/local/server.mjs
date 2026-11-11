import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const TEST_FILES = [
  "tests/egress-proxy.test.js",
  "tests/egress-proxy-hardening.test.js",
  "tests/egress-proxy-socket.integration.test.js",
  "tests/egress-proxy-body-socket.integration.test.js"
];

const server = createServer(async (request, response) => {
  if (request.method === "GET" && request.url === "/health") {
    response.writeHead(200, { "cache-control": "no-store" }).end("ok");
    return;
  }
  if (request.method !== "POST" || request.url !== "/run") {
    response.writeHead(404, { "cache-control": "no-store" }).end();
    return;
  }

  try {
    const result = await execFileAsync("node", ["--test", ...TEST_FILES], {
      cwd: "/workspace",
      timeout: 90_000,
      maxBuffer: 4 * 1024 * 1024
    });
    response.writeHead(200, {
      "content-type": "application/json",
      "cache-control": "no-store"
    }).end(JSON.stringify({
      success: true,
      stdout: result.stdout,
      stderr: result.stderr
    }));
  } catch (error) {
    response.writeHead(500, {
      "content-type": "application/json",
      "cache-control": "no-store"
    }).end(JSON.stringify({
      success: false,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || error?.message || "container_test_failed")
    }));
  }
});

server.listen(8080, "0.0.0.0");
