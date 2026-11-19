import test from "node:test";
import assert from "node:assert/strict";
import { pluginCapabilities } from "../src/plugin-capabilities.js";
import { startHarness } from "./e2e/harness.js";

test("plugin capability status reports only configured and real actions", () => {
  const result = pluginCapabilities({
    TAVILY_API_KEY: "search-key",
    BOR_VISION_ENABLED: "true",
    BOR_IMAGES_ENABLED: "true",
    OPENAI_API_KEY: "image-key",
    DB: {},
    IMAGE_FILES: {},
    IMAGE_QUEUE: {},
    IMAGE_CREDITS_GENERATE: "5",
    IMAGE_CREDITS_EDIT: "8",
    IMAGE_TARIFF_VERSION: "test-v1",
    GITHUB_APP_CLIENT_ID: "id",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_APP_REDIRECT_URI: "https://example.test/api/github/callback",
    GITHUB_TOKEN_ENCRYPTION_KEY: "key"
  });

  assert.equal(result.tools.webSearch.available, true);
  assert.equal(result.tools.webSearch.invocation, "automatic");
  assert.deepEqual(result.tools.fileAnalysis.formats, ["PDF", "DOCX", "XLSX", "PPTX", "CSV", "JPG", "PNG", "WEBP"]);
  assert.equal(result.tools.fileAnalysis.imageVision, true);
  assert.equal(result.tools.imageGeneration.available, true);
  assert.equal(result.tools.emailDrafts.connectedAccount, false);
  assert.equal(result.tools.emailDrafts.sendsEmail, false);
  assert.equal(result.tools.github.available, true);
  assert.equal(result.tools.github.inChatActions, false);
  assert.equal(result.tools.github.writes, false);
  assert.doesNotMatch(JSON.stringify(result), /search-key|image-key|secret|callback/);
});

test("plugin capability status fails closed when providers and paid image setup are absent", () => {
  const result = pluginCapabilities({});
  assert.equal(result.tools.webSearch.available, false);
  assert.equal(result.tools.fileAnalysis.available, true);
  assert.equal(result.tools.fileAnalysis.imageVision, false);
  assert.equal(result.tools.imageGeneration.available, false);
  assert.equal(result.tools.github.available, false);
});

test("public capabilities endpoint exposes safe feature flags without exposing credentials", async (t) => {
  const app = await startHarness({ extraEnv: { TAVILY_API_KEY: "test-search-secret", BOR_IMAGES_ENABLED: "false" } });
  t.after(() => app.close());
  const response = await fetch(app.url + "/api/plugins/capabilities");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  const payload = await response.json();
  assert.equal(payload.tools.webSearch.available, true);
  assert.equal(payload.tools.fileAnalysis.available, true);
  assert.equal(payload.tools.imageGeneration.available, false);
  assert.equal(payload.tools.emailDrafts.sendsEmail, false);
  assert.doesNotMatch(JSON.stringify(payload), /test-search-secret/);
  const method = await fetch(app.url + "/api/plugins/capabilities", { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
});
