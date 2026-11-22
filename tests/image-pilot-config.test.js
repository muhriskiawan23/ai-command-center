import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync,mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

test('image pilot config serializes Queue consumer and keeps original Worker defaults unchanged',()=>{
 const folder=mkdtempSync(join(tmpdir(),'bor-image-pilot-'));
 try {
  const output=join(folder,'images.jsonc');
  const env={...process.env,IMAGE_CREDITS_GENERATE:'10',IMAGE_CREDITS_EDIT:'12',IMAGE_TARIFF_VERSION:'synthetic-test-v1',IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT:'1',IMAGE_PILOT_BUDGET_USD:'2'};
  const result=spawnSync(process.execPath,['scripts/prepare-image-config.mjs',output],{cwd:process.cwd(),env,encoding:'utf8',timeout:20000});
  assert.equal(result.status,0,result.stderr);
  const config=JSON.parse(readFileSync(output,'utf8'));
  assert.equal(config.queues.producers[0].binding,'IMAGE_QUEUE');
  assert.equal(config.queues.consumers[0].max_batch_size,1);
  assert.equal(config.queues.consumers[0].max_concurrency,1);
  assert.equal(config.vars.BOR_IMAGES_ENABLED,'true');
  assert.equal(config.vars.IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT,'1');
  assert.equal(config.vars.IMAGE_DAILY_LIMIT_GLOBAL,'1');
  assert.equal(config.vars.IMAGE_PILOT_OWNER_BUDGET_USD,'2');
  const original=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  assert.equal(original.vars.BOR_IMAGES_ENABLED,'false');
  assert.equal(original.queues?.consumers?.length||0,0);
 } finally {rmSync(folder,{recursive:true,force:true});}
});

test('image release refuses missing budget, >2 dollars or multiple lifetime calls before generating paid config',()=>{
 const folder=mkdtempSync(join(tmpdir(),'bor-image-budget-'));
 try{
  const output=join(folder,'images.jsonc');
  const base={...process.env,IMAGE_CREDITS_GENERATE:'10',IMAGE_CREDITS_EDIT:'12',IMAGE_TARIFF_VERSION:'synthetic-test-v1',
    IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT:'1',IMAGE_PILOT_BUDGET_USD:'2'};
  for(const changes of [
    {IMAGE_PILOT_BUDGET_USD:''},
    {IMAGE_PILOT_BUDGET_USD:'5'},
    {IMAGE_PILOT_BUDGET_USD:'1.99'},
    {IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT:'2'},
    {IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT:'10'}
  ]){
    const run=spawnSync(process.execPath,['scripts/prepare-image-config.mjs',output],
      {cwd:process.cwd(),env:{...base,...changes},encoding:'utf8',timeout:20000});
    assert.notEqual(run.status,0,JSON.stringify(changes));
    assert.equal(run.stderr.includes('OPENAI_API_KEY'),false);
    assert.throws(()=>readFileSync(output,'utf8'),/ENOENT/);
  }
 }finally{rmSync(folder,{recursive:true,force:true});}
});
