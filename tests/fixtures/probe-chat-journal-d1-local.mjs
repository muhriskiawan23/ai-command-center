// Verifies local Workerd D1 + DO execution, NOT remote Cloudflare staging.
import assert from 'node:assert/strict';
import {setTimeout as sleep} from 'node:timers/promises';
import {PURPOSE} from '../../src/chat-journal-staging-d1-recovery-drill.js';

const base='http://127.0.0.1:8799';
let ready=false;
for(let attempt=0;attempt<120;attempt++){
  try {
    const res=await fetch(base+'/__health', {signal:AbortSignal.timeout(1000)});
    if(res.status===404){ready=true;break;}
  }catch{}
  await sleep(500);
}
assert.equal(ready,true,'Local Wrangler runtime did not become ready in 60 s');
let reply=await fetch(base+'/__synthetic_recovery_do_d1',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({purpose:'invalid'})
});
assert.equal(reply.status,403,'Invalid synthetic payload must fail closed');
reply=await fetch(base+'/__synthetic_recovery_do_d1',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({purpose:PURPOSE})
});
const body=await reply.json();
assert.equal(reply.status,200,'Local Worker recovery returned '+reply.status);
assert.equal(body.ok,true);
for(const k of ['passed','syntheticOnly','journalCommitted',
  'rollbackBeforeCheckpoint','batchAtomic','retryIdempotent',
  'replayAgainNoOp','foreignKeysClean']){
  assert.equal(body.result[k],true,k);
}
for(const k of ['productionD1Accessed','customerDataAccessed','productionRecoveryProven']){
  assert.equal(body.result[k],false,k);
}
assert.equal(body.result.restoredMessages,2);
assert.equal(body.result.checkpoint,3);
reply=await fetch(base+'/__synthetic_recovery_do_d1',{
  method:'POST',headers:{'Content-Type':'application/json'},
  body:JSON.stringify({purpose:PURPOSE})
});
assert.equal(reply.status,409,'Second run against reused D1 must fail closed');
console.log('PASS: real local Workerd Durable Object + D1 atomic rollback, retry and replay; no Cloudflare API or paid resources.');
