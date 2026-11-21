import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function load(relative) {
  return readFileSync(new URL("../" + relative, import.meta.url), "utf8");
}

test("browser staging is separated from live BOR AI Worker and defaults to disabled", () => {
  const prod = JSON.parse(load("wrangler.jsonc"));
  const staging = JSON.parse(load("staging/browser/wrangler.example.jsonc"));
  assert.equal(prod.browser, undefined, "main BOR AI Worker must not get browser binding via this PR");
  assert.equal(prod.d1_databases?.some(db => db.binding === "BROWSER_DB"), false);
  assert.equal(staging.browser.binding, "BOR_BROWSER");
  assert.equal(staging.workers_dev, false);
  assert.equal(staging.vars.STAGING_BROWSER_ENABLED, "false");
  assert.equal(staging.vars.STAGING_BROWSER_DAILY_SECONDS_LIMIT, "0");
  assert.equal(staging.vars.STAGING_BROWSER_RESERVATION_SECONDS, "0");
  assert.match(staging.d1_databases[0].database_id, /REPLACE_WITH_NEW_STAGING_D1_ID/);
  assert.equal(staging.d1_databases[0].binding, "BROWSER_DB");
  assert.notEqual(staging.d1_databases[0].database_name, "bor-ai-chat");
  assert.notEqual(staging.d1_databases[0].database_name, "bor-ai-billing-staging");
});

test("production Worker does not import or expose the staging browser handler", () => {
  const prod = load("src/index.js");
  assert.doesNotMatch(prod, /from\s*["']\.\/browser-staging-(?:handler|executor|budget)\.js["']/);
  assert.doesNotMatch(prod, /["']\/api\/browser\/read["']/);
  const worker = load("staging/browser/worker.js");
  assert.match(worker, /createBrowserStagingHandler/);
  assert.doesNotMatch(worker, /src\/index\.js|billing-staging-worker/);
});

test("staging CI is dry-run and never has a deploy or browser-launch step", () => {
  const workflow = load(".github/workflows/bor-ai-browser-staging-dry-run.yml");
  assert.match(workflow, /wrangler deploy --dry-run/);
  assert.doesNotMatch(workflow, /wrangler deploy\s*\n/);
  assert.doesNotMatch(workflow, /STAGING_BROWSER_ENABLED\s*=\s*["']true["']/);
  assert.doesNotMatch(workflow, /CLOUDFLARE_API_TOKEN|CLOUDFLARE_ACCOUNT_ID/);
});
