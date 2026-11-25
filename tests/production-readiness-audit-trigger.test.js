import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyReaderBindings, verifyPublicReader } from '../scripts/readiness-reader-policy.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/bor-ai-readonly-production-readiness.yml', import.meta.url),
  'utf8'
);
const triggers = workflow.split('\npermissions:')[0];

test('read-only production safety checks run after merge of sensitive Worker and release changes', () => {
  assert.match(triggers, /^on:\n  workflow_dispatch:\n    inputs:\n      expected_reader_state:\n/m);
  assert.match(triggers, /^        default: 'off'$/m);
  assert.match(triggers, /^        options:\n          - 'off'\n          - preserved$/m);
  assert.match(triggers, /^  push:\n    branches: \[main\]\n    paths:/m);
  assert.ok(workflow.includes("EXPECTED_READER_STATE: \${{ inputs.expected_reader_state || 'off' }}".replace("\\$", "$")));
  assert.ok(workflow.includes("github.ref == 'refs/heads/main'"));
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
    'scripts/reader-preserve-guard.mjs',
    'scripts/readiness-reader-policy.mjs'
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
  assert.match(workflow, /verifyReaderBindings\(bindings,process\.env\.EXPECTED_READER_STATE,process\.env\.GITHUB_EVENT_NAME\)/);
  assert.throws(() => verifyReaderBindings([{name:'URL_READER_ENABLED',type:'plain_text',text:'true'}], 'off', 'push'), /Reader safe-off/);
  assert.match(workflow, /Active Worker image generation is not verifiably OFF/);
  assert.throws(() => verifyPublicReader({tools:{}}, 'off', 'push'), /Public Reader\/Web Actions/);
});

test('readiness workflow never mutates production or calls billable providers', () => {
  assert.match(workflow, /Check production public health and agents without inference/);
  assert.doesNotMatch(workflow, /\bwrangler\s+(?:deploy|d1|r2|queues|secret|versions|triggers)\b/i);
  assert.doesNotMatch(workflow, /\bcurl\b[^\n]*\s(?:-X|--request)\s*(?:POST|PUT|PATCH|DELETE)\b/i);
  assert.doesNotMatch(workflow, /api\/images\/jobs|api\/chat|tavily\.com|api\.openai\.com/i);
  assert.match(workflow, /Binding names and secret values are not printed/);
});

test('active image binding is triaged even when Reader state is a release blocker', () => {
  const readerFailure = workflow.indexOf('verifyReaderBindings(bindings,process.env.EXPECTED_READER_STATE,process.env.GITHUB_EVENT_NAME)');
  const imageInspect = workflow.indexOf('const images = named("BOR_IMAGES_ENABLED")');
  const imageLog = workflow.indexOf('console.log("Active Image Assistant binding state:", imageState)');
  assert.ok(imageInspect > 0 && imageLog > imageInspect, 'image state must be inspected and reported');
  assert.ok(readerFailure > imageLog, 'Reader mismatch must not mask paid-image binding status');
  assert.throws(() => verifyReaderBindings([], 'off', 'push'), /Reader safe-off/);
  assert.match(workflow, /Active Worker image generation is not verifiably OFF/);
});


test('read-only audit triages deployed release SHA before rejecting active URL Reader divergence', () => {
  const release = workflow.indexOf('const releaseMessage = deployment?.annotations?.["workers/message"]');
  const report = workflow.indexOf('console.log("Production release synchronization: PENDING")');
  const readerFail = workflow.indexOf('verifyReaderBindings(bindings,process.env.EXPECTED_READER_STATE,process.env.GITHUB_EVENT_NAME)');
  assert.ok(release > 0 && report > release && readerFail > report,
    'Release drift evidence must be emitted even when the active Reader violates baseline');
  assert.match(workflow, /const activeExtractSafe = !limit\.length/);
  assert.ok(workflow.indexOf('"Read-only release safe-off checks:"') < readerFail);
  assert.match(workflow, /const activeImagesSafe = imageState === "absent" \|\| imageState === "off"/);
  assert.match(workflow, /"Read-only release safe-off checks:"/);
  assert.doesNotMatch(workflow, /console\.log\(["'].*secret.*(?:token|key|binding)\b/i);
});

test('public capability schema mismatch is classified without exposing response or relaxing fail-closed gate', () => {
  assert.match(workflow, /console\.log\("Public capabilities schema:"/);
  assert.match(workflow, /console\.log\("Public capability fields:"/);
  assert.match(workflow, /readerEnabled: feature\(reading\?\.enabled\)/);
  assert.match(workflow, /actionsAvailable: feature\(actions\?\.available\)/);
  assert.match(workflow, /verifyPublicReader\(data,process\.env\.EXPECTED_READER_STATE,process\.env\.GITHUB_EVENT_NAME\)/);
  for (const data of [
    {},
    {tools:{}},
    {tools:{webReading:{enabled:true,available:false},webActions:{available:false}}},
    {tools:{webReading:{enabled:false,available:true},webActions:{available:false}}},
    {tools:{webReading:{enabled:false,available:false},webActions:{available:true}}}
  ]) assert.throws(() => verifyPublicReader(data,'off','push'), /Public Reader\/Web Actions/);
  assert.equal(verifyPublicReader({tools:{webReading:{enabled:false,available:false},webActions:{available:false}}},'off','push'),true);
  assert.doesNotMatch(workflow, /console\.log\([^;\n]*(?:JSON\.stringify\(data\)|JSON\.stringify\(body\))/);
});
