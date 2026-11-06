import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const app = readFileSync(new URL("../public/app.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../public/app.css", import.meta.url), "utf8");
test("feedback controls are available only for saved assistant answers in signed-in sessions", () => {
  assert.match(app, /role==="assistant"&&state===AppState\.AUTH&&controls\.responseId&&controls\.conversationId/);
  assert.match(app, /Jawaban membantu/);
  assert.match(app, /Jawaban tidak membantu/);
  assert.match(app, /\/api\/feedback/);
  assert.match(app, /controls\.feedback\|\|null/);
});
test("feedback reason is optional, bounded, accessible, and its saved state is restored", () => {
  assert.match(app, /reason\.maxLength=500/);
  assert.match(app, /Alasan feedback opsional/);
  assert.match(app, /existing\.reason\|\|""/);
  assert.match(app, /Feedback tersimpan/);
  assert.match(css, /\.answer-feedback/);
  assert.match(css, /\.feedback-panel/);
});
