import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const page = readFileSync(new URL("../public/index.html", import.meta.url), "utf8");
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const activity = readFileSync(new URL("../public/agent-activity.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/agent-activity.css", import.meta.url), "utf8");

test("Agent Activity loads its own same-origin assets and required controls", () => {
  for (const id of [
    "agentActivityTrigger", "agentActivityPanel", "agentActivityBackdrop",
    "agentActivityClose", "agentActivityStop", "agentActivityMotion",
    "agentActivityStatus", "agentActivityTask", "agentActivityAgent",
    "agentActivityDetails", "agentActivityTools"
  ]) assert.match(page, new RegExp('id="' + id + '"'));
  assert.match(page, /<script src="\/agent-activity\.js" defer><\/script>/);
  assert.match(page, /<link rel="stylesheet" href="\/agent-activity\.css">/);
  assert.doesNotThrow(() => new Function(activity));
});

test("Activity uses the real chat request lifecycle without fabricated progress", () => {
  assert.match(app, /bor:agent-activity/);
  for (const phase of ["started", "completed", "cancelled", "failed"])
    assert.ok(app.includes('publishActivity("' + phase + '"'), "missing phase " + phase);
  assert.match(activity, /existingStop\.click\(\)/);
  assert.match(activity, /data\.requestId !== current\.requestId/);
  assert.match(app, /bor:session-state/);
  assert.match(activity, /addEventListener\("bor:session-state"/);
  assert.match(activity, /requestId: null, agent: "", task: ""/);
  assert.doesNotMatch(activity, /setInterval|fetch\(|percentComplete|progress:\s*80/);
});

test("Living B motion is opt-in and respects reduced-motion setting", () => {
  assert.match(activity, /getItem\(MOTION_KEY\) === "on"/);
  assert.match(css, /prefers-reduced-motion:reduce/);
  assert.match(page, /logo-mark\.svg/);
  assert.match(page, /aria-expanded="false"/);
});
