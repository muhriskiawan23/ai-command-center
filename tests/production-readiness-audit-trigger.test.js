import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(
  new URL('../.github/workflows/bor-ai-readonly-production-readiness.yml', import.meta.url),
  'utf8'
);
const triggers = workflow.split('\npermissions:')[0];

test('read-only production safety checks run after merge of sensitive Worker and release changes', () => {
  assert.match(triggers, /^on:\n  workflow_dispatch:\n  push:\n    branches: \[main\]\n    paths:/m);
  for (const path of [
    '.github/workflows/bor-ai-readonly-production-readiness.yml',
    '.github/workflows/bor-ai-deploy.yml',
    '.github/workflows/bor-ai-image-d1-release.yml',
    'wrangler.jsonc',
    'src/index.js',
    'src/links.js',
    'src/tavily-extract.js',
    'src/verified-egress.js',
    'src/plugin-capabilities.js',
    'src/image-jobs.js',
    'scripts/reader-preserve-guard.mjs'
  ]) {
    assert.ok(triggers.includes("      - '" + path + "'"), path + ' must trigger audited-main production inspection');
  }
  assert.match(workflow, /environment: production/);
});

test('audit checks the active 100-percent Worker version, not only source config', () => {
  assert.match(workflow, /\/deployments\?per_page=1/);
  assert.ok(workflow.includes('active?.length !== 1 || active[0].percentage !== 100'));
  assert.match(workflow, /\/versions\/["']? \+ encodeURIComponent\(active\[0\]\.version_id\)/);
  assert.match(workflow, /named\("URL_READER_ENABLED"\)/);
  assert.match(workflow, /named\("TAVILY_EXTRACT_DAILY_URL_LIMIT"\)/);
  assert.match(workflow, /named\("BOR_IMAGES_ENABLED"\)/);
  assert.match(workflow, /Active Worker URL Reader is not verifiably OFF/);
  assert.match(workflow, /Active Worker image generation is not verifiably OFF/);
  assert.match(workflow, /webReading\/webActions; cannot verify the safe-off release/);
});

test('readiness workflow never mutates production or calls billable providers', () => {
  assert.match(workflow, /Check production public health and agents without inference/);
  assert.doesNotMatch(workflow, /\bwrangler\s+(?:deploy|d1|r2|queues|secret|versions|triggers)\b/i);
  assert.doesNotMatch(workflow, /\bcurl\b[^\n]*\s(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b/i);
  assert.doesNotMatch(workflow, /api\/images\/jobs|api\/chat|tavily\.com|api\.openai\.com/i);
  assert.match(workflow, /Binding names and secret values are not printed/);
});

test('active image binding is triaged even when Reader state is a release blocker', () => {
  const readerFailure = workflow.indexOf('if (flag.length !== 1 || flag[0].type !== "plain_text"');
  const imageInspect = workflow.indexOf('const images = named("BOR_IMAGES_ENABLED")');
  const imageLog = workflow.indexOf('console.log("Active Image Assistant binding state:", imageState)');
  assert.ok(imageInspect > 0 && imageLog > imageInspect, 'image state must be inspected and reported');
  assert.ok(readerFailure > imageLog, 'Reader mismatch must not mask paid-image binding status');
  assert.match(workflow, /Active Worker URL Reader is not verifiably OFF/);
  assert.match(workflow, /Active Worker image generation is not verifiably OFF/);
});


test('read-only audit triages deployed release SHA before rejecting active URL Reader divergence', () => {
  const release = workflow.indexOf('const releaseMessage = deployment?.annotations?.["workers/message"]');
  const report = workflow.indexOf('console.log("Production release synchronization: PENDING")');
  const readerFail = workflow.indexOf('if (!activeReaderSafe) throw new Error("Active Worker URL Reader is not verifiably OFF")');
  assert.ok(release > 0 && report > release && readerFail > report,
    'Release drift evidence must be emitted even when the active Reader violates baseline');
  assert.match(workflow, /const activeExtractSafe = !limit\.length/);
  assert.match(workflow, /const activeImagesSafe = imageState === "absent" \|\| imageState === "off"/);
  assert.match(workflow, /"Read-only release safe-off checks:"/);
  assert.doesNotMatch(workflow, /console\.log\(["'].*secret.*(?:token|key|binding)\b/i);
});

test('public capability schema mismatch is classified without exposing response or relaxing fail-closed gate', () => {
  assert.match(workflow, /console\.log\("Public capabilities schema:"/);
  assert.match(workflow, /console\.log\("Public capability fields:"/);
  assert.match(workflow, /readerEnabled: feature\(reading\?\.enabled\)/);
  assert.match(workflow, /actionsAvailable: feature\(actions\?\.available\)/);
  assert.match(workflow, /Active production capabilities are missing webReading\/webActions/);
  assert.match(workflow, /reading\.enabled !== false \|\| reading\.available !== false \|\| actions\.available !== false/);
  assert.doesNotMatch(workflow, /console\.log\([^;\n]*(?:JSON\.stringify\(data\)|JSON\.stringify\(body\))/);
});
