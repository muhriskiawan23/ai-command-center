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
