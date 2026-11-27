import {createPrimaryLedger} from '../primary-ledger.mjs';
async function runLedgerTests(create){
 const assert=v=>{if(!v)throw Error('assertion failed')};
 function setup(evidence={state:'confirmed_closed',upperMicrousd:60000}){
  const data=new Map([['primary-legacy-evidence-v1',evidence]]);
  let tail=Promise.resolve(),day=0;
  const storage={transaction(fn){const p=tail.then(()=>fn({get:async k=>data.get(k),put:async(k,v)=>data.set(k,v)}));tail=p.catch(()=>{});return p}};
  const assessExposure=({legacy,ledger,providerMaxSeconds})=>!legacy||legacy.state!=='confirmed_closed'?{allowed:false,reason:'legacy_unconfirmed'}:providerMaxSeconds!==120?{allowed:false,reason:'provider_limit_unverified'}:ledger.some(r=>r.state!=='closed'||r.actualMicrousd>r.reservedMicrousd)?{allowed:false,reason:'ledger_unconfirmed_or_overrun'}:legacy.upperMicrousd+ledger.length*100000+100000>300000?{allowed:false,reason:'global_limit'}:{allowed:true};
  const ledger=create({storage,assessExposure,providerMaxSeconds:120,now:()=>1700000000000+day*86400000});
  const reserve=(i,userId='owner')=>ledger.reserve({userId,attemptId:'primary-test-'+String(i).padStart(4,'0')});
  const settle=(i,patch={})=>ledger.settle({attemptId:'primary-test-'+String(i).padStart(4,'0'),confirmed:true,sessionId:'live_test',usage:{seconds:30},latestSeconds:20,...patch});
  return {reserve,settle,nextDay:()=>day++,data};
 }
 const cases=[
  async()=>{const f=setup({state:'unconfirmed'});assert(!(await f.reserve(1)).ok)},
  async()=>{const f=setup();const r=await Promise.all([f.reserve(1),f.reserve(2,'other')]);assert(r.filter(x=>x.ok).length===1)},
  async()=>{const f=setup();await f.reserve(1);assert((await f.reserve(1)).reason==='duplicate')},
  async()=>{const f=setup();await f.reserve(1);const row=await f.settle(1);assert(row.state==='closed'&&row.actualMicrousd===25000);assert((await f.reserve(2)).reason==='user_limit')},
  async()=>{const f=setup();await f.reserve(1);const row=await f.settle(1,{confirmed:false});f.nextDay();assert(row.state==='unconfirmed'&&!(await f.reserve(2)).ok)},
  async()=>{const f=setup();await f.reserve(1);const row=await f.settle(1,{usage:{seconds:10}});assert(row.state==='unconfirmed')},
  async()=>{const f=setup();await f.reserve(1);const row=await f.settle(1,{usage:{seconds:1},latestSeconds:0});assert(row.actualMicrousd===12500)},
  async()=>{const f=setup();await f.reserve(1);await f.settle(1,{usage:{seconds:150}});f.nextDay();assert(!(await f.reserve(2)).ok)},
  async()=>{const f=setup();await f.reserve(1);await f.settle(1);const again=await f.settle(1,{confirmed:false});assert(again.state==='closed'&&again.actualMicrousd===25000)},
  async()=>{const f=setup();await f.reserve(1);await f.settle(1);f.nextDay();assert((await f.reserve(2)).ok);await f.settle(2);f.nextDay();assert((await f.reserve(3)).reason==='global_limit')}
 ];
 for(const c of cases)await c();return{passed:cases.length,total:cases.length}
}
console.log(await runLedgerTests(createPrimaryLedger));
