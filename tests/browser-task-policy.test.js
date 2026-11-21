import test from "node:test";
import assert from "node:assert/strict";
import {
  validateBrowserTarget, planBrowserTask, browserExecutionGate,
  BROWSER_MAX_STEPS, BROWSER_MAX_SESSION_SECONDS, BROWSER_POLICY_VERSION
} from "../src/browser-task-policy.js";

test("public HTTPS article gets exact-host guardrails and read-only preview", () => {
  const result = planBrowserTask({ url: "https://example.org/articles/hello", steps: [
    { type: "read_text" }, { type: "inspect_links" }, { type: "screenshot" }
  ] });
  assert.equal(result.ok, true);
  const p = result.plan;
  assert.equal(p.version, BROWSER_POLICY_VERSION);
  assert.equal(p.mode, "preview_only");
  assert.equal(p.hostname, "example.org");
  assert.equal(p.url, "https://example.org/articles/hello");
  assert.deepEqual(p.guardrails, { allowedDomains: ["example.org"] });
  assert.equal(p.limits.maxSessionSeconds, BROWSER_MAX_SESSION_SECONDS);
  assert.equal(p.limits.maxNavigations, 1);
  assert.equal(p.executionEnabled, false);
  assert.equal(p.approvalRequired, false);
});

test("defaults to reading a page without launching a browser", () => {
  const result = planBrowserTask({ url: "https://news.example.org/story" });
  assert.deepEqual(result.plan.steps, [{ type: "read_text" }]);
  assert.equal(result.plan.executionEnabled, false);
});

test("blocks local, private, metadata and non-web URLs before any task exists", () => {
  const bad = [
    "https://localhost/admin", "https://metadata.google.internal/",
    "http://169.254.169.254/latest/meta-data",
    "https://10.0.0.1/", "https://127.0.0.1/",
    "https://[::1]/", "https://[2001:db8::1]/",
    "https://2130706433/", "https://0x7f000001/",
    "https://example.com:8443/admin",
    "file:///etc/passwd", "javascript:alert(1)",
    "https://user:password@example.com/",
    "https://intranet.local/"
  ];
  for (const url of bad) assert.equal(planBrowserTask({ url }).ok, false, url);
});

test("limits initial browser targets to HTTPS public DNS names", () => {
  assert.equal(validateBrowserTarget("http://example.com").code, "https_only");
  assert.equal(planBrowserTask({ url: "https://8.8.8.8" }).code, "hostname_not_supported");
  assert.equal(planBrowserTask({ url: "https://example.com" }, { ownHost: "example.com" }).code, "unsafe_url");
});

test("rejects URL credential leakage, signed queries, fragment secrets and private auth paths", () => {
  for (const url of [
    "https://example.com/article?token=secret",
    "https://example.com/article?data=arbitrary",
    "https://example.com/article#session-token",
    "https://example.com/oauth/callback",
    "https://example.com/reset/abc",
    "https://example.com/checkout",
    "https://example.com/signin"
  ]) assert.equal(planBrowserTask({ url }).ok, false, url);
});

test("click previews require separate approval and never run implicitly", () => {
  const task = planBrowserTask({
    url: "https://example.com/help",
    steps: [{ type: "read_text" }, { type: "click", selector: "#show-details" }]
  });
  assert.equal(task.ok, true);
  assert.equal(task.plan.approvalRequired, true);
  assert.equal(task.plan.steps[1].requiresUserApproval, true);
  assert.equal(task.plan.executionEnabled, false);
  assert.equal(browserExecutionGate({ BOR_BROWSER_AUTOMATION_ENABLED: "true" }, task).code, "action_requires_approval");
});

test("form values never appear in previews and fill requires explicit approval", () => {
  const secret = "secret user input 123";
  const task = planBrowserTask({
    url: "https://example.com/contact",
    steps: [{ type: "fill", selector: '[data-testid="email"]', value: secret }]
  });
  assert.equal(task.ok, true);
  assert.equal(task.plan.approvalRequired, true);
  assert.equal(task.plan.steps[0].valueRedacted, true);
  assert.doesNotMatch(JSON.stringify(task), /secret user input/);
  assert.equal(Object.hasOwn(task.plan.steps[0], "value"), false);
});

test("rejects script execution, arbitrary HTML, submit and unsupported browser actions", () => {
  for (const action of ["eval", "script", "javascript", "submit", "buy", "send", "delete", "download"]) {
    assert.equal(planBrowserTask({
      url: "https://example.com", steps: [{ type: action }]
    }).code, "action_not_supported");
  }
  assert.equal(planBrowserTask({
    url: "https://example.com", steps: [{ type: "read_text", script: "alert(1)" }]
  }).code, "unknown_action_parameter");
  assert.equal(planBrowserTask({
    url: "https://example.com", steps: [{ type: "click", selector: "body:has(script)" }]
  }).code, "unsafe_selector");
});

test("limits step count, selectors, fill length and top-level request keys", () => {
  const url = "https://example.com";
  assert.equal(planBrowserTask({ url, steps: [] }).code, "step_limit");
  assert.equal(planBrowserTask({
    url, steps: Array(BROWSER_MAX_STEPS + 1).fill({ type: "read_text" })
  }).code, "step_limit");
  assert.equal(planBrowserTask({ url, steps: [{ type: "fill", selector: "#email", value: "" }] }).code, "invalid_fill");
  assert.equal(planBrowserTask({ url, steps: [{ type: "fill", selector: "#email", value: "x".repeat(251) }] }).code, "invalid_fill");
  assert.equal(planBrowserTask({ url, cookies: "not-permitted" }).code, "invalid_request");
  assert.equal(planBrowserTask({ url, steps: [{ type: "click", selector: "button", headers: {} }] }).code, "unsafe_selector");
});

test("cannot enable a live browser using flags or a fake account configuration", () => {
  const preview = planBrowserTask({ url: "https://example.com", steps: [{ type: "read_text" }] });
  assert.equal(browserExecutionGate({}, preview).code, "feature_disabled");
  assert.equal(browserExecutionGate({
    BOR_BROWSER_AUTOMATION_ENABLED: "true",
    BOR_BROWSER_DAILY_SECONDS_LIMIT: "1000000",
    BROWSER: { launch: () => { throw Error("should not launch"); } }
  }, preview).code, "browser_runtime_not_connected");
  assert.equal(browserExecutionGate({ BOR_BROWSER_AUTOMATION_ENABLED: "true" }, {}).code, "invalid_plan");
});
