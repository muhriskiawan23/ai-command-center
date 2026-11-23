import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {spawnSync} from 'node:child_process';

const workflow=readFileSync(new URL('../.github/workflows/bor-ai-deploy.yml',import.meta.url),'utf8');
const manifest=readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8');
const script=new URL('../scripts/prepare-billing-shadow-config.mjs',import.meta.url).pathname;
const ID='88888888-8888-4888-8888-888888888888';

test('production workflow compiles generated shadow config before remote SQL writes',()=>{
  const consent=workflow.indexOf('run: node scripts/review-billing-shadow-dispatch.mjs');
  const metadata=workflow.indexOf('run: node scripts/audit-cloudflare-d1-metadata-readonly.mjs');
  const generated=workflow.indexOf('run: node scripts/prepare-billing-shadow-config.mjs');
  const dryRun=workflow.indexOf('npx --yes wrangler@4 deploy --dry-run --config "$BOR_DEPLOY_CONFIG"');
  const sql=workflow.indexOf('--file staging/billing-shadow/0001_readonly_schema.sql');
  assert.ok(consent>=0&&metadata>consent&&generated>metadata&&dryRun>generated&&sql>dryRun);
  const step=workflow.slice(workflow.lastIndexOf('      - name:',dryRun),dryRun);
  assert.match(step,/if: \$\{\{ env\.BOR_BILLING_SHADOW_ENABLED == 'true' \}\}/);
  assert.match(step,/set -euo pipefail/);
  assert.match(step,/wrangler\.billing-shadow\.generated\.jsonc/);
  assert.doesNotMatch(step,/\bd1 execute\b|\bd1 migrations apply\b|--remote/);
});
test('offline candidate generation uses a distinct D1 and leaves production defaults untouched',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bor-shadow-candidate-dryrun-'));
  const envFile=join(dir,'github_env');
  try{
    writeFileSync(join(dir,'wrangler.jsonc'),manifest);
    writeFileSync(envFile,'');
    const result=spawnSync(process.execPath,[script],{
      cwd:dir,encoding:'utf8',
      env:{...process.env,BOR_DEPLOY_CONFIG:'wrangler.jsonc',
        BOR_BILLING_SHADOW_D1_ID:ID,GITHUB_ENV:envFile}
    });
    assert.equal(result.status,0,result.stderr);
    const candidate=JSON.parse(readFileSync(join(dir,'wrangler.billing-shadow.generated.jsonc'),'utf8'));
    const base=JSON.parse(manifest);
    assert.equal(candidate.name,base.name);
    assert.equal(candidate.main,base.main);
    assert.equal(candidate.d1_databases.length,2);
    assert.deepEqual(candidate.d1_databases[0],base.d1_databases[0]);
    assert.deepEqual(candidate.d1_databases[1],{
      binding:'BILLING_SHADOW_DB',database_name:'bor-ai-billing-shadow',database_id:ID
    });
    assert.equal(candidate.vars.BOR_BILLING_SHADOW_ENABLED,'true');
    assert.equal(candidate.vars.BOR_BILLING_SHADOW_D1_NAME,'bor-ai-billing-shadow');
    assert.equal('BOR_BILLING_SHADOW_PEPPER' in candidate.vars,false);
    assert.equal(readFileSync(join(dir,'wrangler.jsonc'),'utf8'),manifest);
    assert.match(readFileSync(envFile,'utf8'),/BOR_DEPLOY_CONFIG=wrangler\.billing-shadow\.generated\.jsonc/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('offline generation rejects accidental reuse of the production chat UUID',()=>{
  const dir=mkdtempSync(join(tmpdir(),'bor-shadow-bad-id-'));
  try{
    writeFileSync(join(dir,'wrangler.jsonc'),manifest);
    const chat=JSON.parse(manifest).d1_databases[0].database_id;
    const result=spawnSync(process.execPath,[script],{
      cwd:dir,encoding:'utf8',
      env:{...process.env,BOR_DEPLOY_CONFIG:'wrangler.jsonc',
        BOR_BILLING_SHADOW_D1_ID:chat,GITHUB_ENV:join(dir,'github_env')}
    });
    assert.notEqual(result.status,0);
    assert.doesNotMatch(result.stderr,/Bearer |PRIVATE_SESSION|api[_-]?key/i);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
