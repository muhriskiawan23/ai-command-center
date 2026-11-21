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
    OPENAI_IMAGE_MODEL: "gpt-image-2",
    IMAGE_PILOT_QUALITY: "low",
    IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT: "10",
    GITHUB_APP_CLIENT_ID: "id",
    GITHUB_APP_CLIENT_SECRET: "secret",
    GITHUB_APP_REDIRECT_URI: "https://example.test/api/github/callback",
    GITHUB_TOKEN_ENCRYPTION_KEY: "key"
  });

  assert.equal(result.tools.webSearch.available, true);
  assert.equal(result.tools.webSearch.invocation, "automatic");
  assert.equal(result.tools.webSearch.scope, "search_result_snippets");
  assert.equal(result.tools.webReading.available, false);
  assert.equal(result.tools.webActions.available, false);
  assert.equal(result.tools.webActions.requiresUserApproval, true);
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
  assert.equal(result.tools.webReading.available, false);
  assert.equal(result.tools.webActions.available, false);
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
  assert.equal(payload.tools.webReading.available, false);
  assert.equal(payload.tools.webActions.available, false);
  assert.equal(payload.tools.fileAnalysis.available, true);
  assert.equal(payload.tools.imageGeneration.available, false);
  assert.equal(payload.tools.emailDrafts.sendsEmail, false);
  assert.doesNotMatch(JSON.stringify(payload), /test-search-secret/);
  const method = await fetch(app.url + "/api/plugins/capabilities", { method: "POST" });
  assert.equal(method.status, 405);
  assert.equal(method.headers.get("allow"), "GET");
});


test("public URL Reader capability is unavailable when any managed Extract prerequisite is missing", () => {
  const ready = {
    URL_READER_ENABLED: "true", URL_READER_PROVIDER: "tavily",
    TAVILY_API_KEY: "do-not-publish-key",
    TAVILY_EXTRACT_DAILY_URL_LIMIT: "8",
    DB: { prepare() {} }
  };
  const active = pluginCapabilities(ready);
  assert.equal(active.tools.webSearch.available, true);
  assert.equal(active.tools.webReading.available, true);
  assert.equal(active.tools.webReading.maxLinksPerMessage, 3);
  assert.equal(active.tools.webReading.externallyVerified, false);
  assert.equal(active.tools.webActions.available, false);
  for (const changed of [
    { URL_READER_ENABLED: "false" },
    { URL_READER_PROVIDER: "unsupported" },
    { TAVILY_API_KEY: "" },
    { TAVILY_API_KEY: "  " },
    { TAVILY_EXTRACT_DAILY_URL_LIMIT: "0" },
    { TAVILY_EXTRACT_DAILY_URL_LIMIT: "not-a-number" },
    { TAVILY_EXTRACT_DAILY_URL_LIMIT: "8.2" },
    { TAVILY_EXTRACT_DAILY_URL_LIMIT: "10001" },
    { DB: {} }
  ]) {
    const result = pluginCapabilities({ ...ready, ...changed });
    assert.equal(result.tools.webReading.available, false, JSON.stringify(Object.keys(changed)));
  }
  assert.doesNotMatch(JSON.stringify(active), /do-not-publish-key/);
});

test("URL Reader live capability endpoint distinguishes independent Search and Extract states", async t => {
  const app = await startHarness({ extraEnv: {
    TAVILY_API_KEY: "private-test-key",
    URL_READER_PROVIDER: "tavily",
    URL_READER_ENABLED: "true",
    TAVILY_EXTRACT_DAILY_URL_LIMIT: "0"
  } });
  t.after(() => app.close());
  let response = await fetch(app.url + "/api/plugins/capabilities");
  assert.equal(response.status, 200);
  let result = await response.json();
  assert.equal(result.tools.webSearch.available, true);
  assert.equal(result.tools.webReading.available, false);
  app.env.TAVILY_EXTRACT_DAILY_URL_LIMIT = "8";
  response = await fetch(app.url + "/api/plugins/capabilities");
  result = await response.json();
  assert.equal(result.tools.webReading.available, true);
  assert.equal(result.tools.webActions.available, false);
  assert.doesNotMatch(JSON.stringify(result), /private-test-key/);
});
