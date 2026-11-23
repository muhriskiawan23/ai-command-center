import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACCOUNT_PIN,PRIMARY_D1_PIN,EXACT_APPROVAL,namesForRun,
  validateSyntheticResource,approvedSyntheticDownloadHost,
  extractSyntheticSignedUrl,validRows,normalizeSyntheticDumpForQuery,runSyntheticD1Drill
} from '../scripts/synthetic-d1-export-recovery-drill.mjs';

const runId='45079999123',sourceId='12345678-1234-1234-1234-123456789001';
const targetId='12345678-1234-1234-1234-123456789002';
const names=namesForRun(runId);
const rows=[
  {event_id:'synthetic-0001',kind:'create',payload:'SYNTHETIC_ONLY_CONVERSATION'},
  {event_id:'synthetic-0002',kind:'message',payload:'SYNTHETIC_ONLY_AFTER_SNAPSHOT'},
  {event_id:'synthetic-0003',kind:'delete',payload:'SYNTHETIC_ONLY_TOMBSTONE'},
  {event_id:'synthetic-0004',kind:'message',payload:'SYNTHETIC_ONLY_AFTER_DELETE'}
];
const sql='CREATE TABLE synth_events(event_id TEXT PRIMARY KEY,kind TEXT NOT NULL,payload TEXT NOT NULL);\n'+
 rows.map(x=>"INSERT INTO synth_events VALUES('"+x.event_id+"','"+x.kind+"','"+x.payload+"');").join('\n');
const env=()=>({
  GITHUB_REPOSITORY:'muhriskiawan23/ai-command-center',GITHUB_REF:'refs/heads/main',
  GITHUB_RUN_ID:runId,CLOUDFLARE_ACCOUNT_ID:ACCOUNT_PIN,
  BOR_PRIVATE_D1_EXPORT_TOKEN:'SYNTHETIC_ONLY_NOT_A_REAL_CLOUDFLARE_TOKEN',
  BOR_SYNTHETIC_OWNER_APPROVAL:EXACT_APPROVAL,BOR_SYNTHETIC_COST_APPROVED:'true'
});

function fakeCloudflare({unexpectedHost=false,failRestore=false}={}){
  const state=new Map(),calls=[];
  let pollCount=0,downloads=0;
  const send=(x,code=200)=>Response.json(x,{status:code});
  const get=async (url,options)=>{
    const path=new URL(url).pathname,method=options?.method||'GET';
    calls.push({path,method,headers:options?.headers||{}});
    if(path==='/fake-export.sql'){
      downloads++;
      return new Response(sql,{headers:{'Content-Type':'application/sql'}});
    }
    assert.equal(new URL(url).hostname,'api.cloudflare.com','Only Cloudflare REST or signed R2');
    assert.ok(path.startsWith('/client/v4/accounts/'+ACCOUNT_PIN+'/d1/database'));
    assert.ok(!path.includes(PRIMARY_D1_PIN));
    const suffix=path.split('/d1/database')[1];
    const body=options?.body?JSON.parse(options.body):null;
    if(method==='POST'&&suffix===''){
      const name=body.name;
      assert.ok(Object.values(names).includes(name));
      const uuid=name===names.source?sourceId:targetId;
      state.set(uuid,{name,uuid,rows:[]});
      return send({success:true,result:{name,uuid}});
    }
    if(method==='GET'&&suffix==='')return send({success:true,result:[...state.values()].map(x=>({name:x.name,uuid:x.uuid}))});
    const id=suffix.split('/')[1];
    const item=state.get(id);
    if(method==='GET'&&suffix==='/'+id)
      return item?send({success:true,result:{name:item.name,uuid:id}}):send({success:false},404);
    if(method==='DELETE'&&suffix==='/'+id){
      assert.ok(Object.values(names).includes(item?.name));
      state.delete(id);return send({success:true,result:{}});
    }
    if(method==='POST'&&suffix==='/'+id+'/query'){
      assert.ok(item,'Query only newly created synthetic DB');
      if(body.sql.includes('CREATE TABLE synth_events')){
        if(failRestore&&id===targetId)return send({success:true,result:[{success:false}]});
        item.rows=[...rows];
        return send({success:true,result:[{success:true,results:[]}]});
      }
      if(body.sql.startsWith('SELECT event_id')){
        return send({success:true,result:[{success:true,results:[...item.rows]}]});
      }
      throw Error('unexpected SQL in synthetic-only drill');
    }
    if(method==='POST'&&suffix==='/'+id+'/export'){
      assert.equal(id,sourceId,'Export MUST target synthetic source not production');
      assert.equal(body.output_format,'polling','D1 requires output_format on start AND poll');
      if(body.current_bookmark===undefined)return send({success:true,result:{at_bookmark:'SYNTHETIC_BOOKMARK_1234567890'}});
      if(body.current_bookmark){
        pollCount++;
        const host=unexpectedHost?'not-cloudflare.example':'synthetic.r2.cloudflarestorage.com';
        return send({success:true,result:{status:'complete',at_bookmark:body.current_bookmark,
          result:{signed_url:'https://'+host+'/fake-export.sql?sig=SYNTHETIC'}}});
      }
    }
    throw Error('unexpected mock API request '+method+' '+suffix);
  };
  // Intercept signed host without leaving this mock.
  const fetcher=async(url,opts)=>{
    if(new URL(url).hostname==='synthetic.r2.cloudflarestorage.com'){
      assert.equal(opts.method,'GET');
      assert.ok(url.includes('/fake-export.sql'));
      downloads++;return new Response(sql,{headers:{'Content-Type':'application/sql'}});
    }
    return get(url,opts);
  };
  return {fetcher,state,calls,metrics:()=>({pollCount,downloads})};
}
test('owner approval, project/account pin and run-scoped names must match',()=>{
  assert.equal(names.source,'bor-ai-synth-recovery-'+runId+'-src');
  assert.equal(names.target,'bor-ai-synth-recovery-'+runId+'-dst');
  assert.throws(()=>namesForRun('fail/../../'),/run_id_invalid/);
  assert.throws(()=>validateSyntheticResource('bor-ai-chat',PRIMARY_D1_PIN,runId),/identity_mismatch/);
  assert.throws(()=>validateSyntheticResource(names.source,PRIMARY_D1_PIN,runId),/identity_mismatch/);
  assert.equal(validateSyntheticResource(names.target,targetId,runId),true);
});
test('signed D1 export URL is limited to HTTPS Cloudflare R2, not arbitrary hosts',()=>{
  assert.equal(approvedSyntheticDownloadHost('https://a.r2.cloudflarestorage.com/sql?sig=hello').hostname,'a.r2.cloudflarestorage.com');
  for(const url of [
    'http://a.r2.cloudflarestorage.com/sql','https://example.org/sql',
    'https://evil.r2.cloudflarestorage.com.example.org/sql',
    'https://user:pass@a.r2.cloudflarestorage.com/sql',
    'https://a.r2.cloudflarestorage.com:8443/sql','ftp://a.r2.cloudflarestorage.com/sql'
  ])assert.throws(()=>approvedSyntheticDownloadHost(url),/signed_url_host_not_allowlisted/);
});
test('nested and direct Cloudflare export envelopes are allowed but conflicts denied',()=>{
  const u='https://a.r2.cloudflarestorage.com/a?sig=1';
  assert.equal(extractSyntheticSignedUrl({success:true,result:{signed_url:u}}),u);
  assert.equal(extractSyntheticSignedUrl({success:true,result:{status:'complete',result:{signed_url:u}}}),u);
  assert.throws(()=>extractSyntheticSignedUrl({success:true,result:{
    status:'complete',signed_url:u,result:{signed_url:'https://other.r2.cloudflarestorage.com'}}
  }),/conflicting_export_urls/);
  assert.throws(()=>extractSyntheticSignedUrl({success:true,result:{status:'polling',signed_url:u}}),/status_mismatch/);
});
test('synthetic row digest includes a deletion tombstone',()=>{
  assert.equal(validRows(rows).length,64);
  assert.throws(()=>validRows(rows.filter(x=>x.kind!=='delete')),/row_count_mismatch/);
});

test('synthetic import strips D1 transaction wrappers and rejects all unapproved SQL',()=>{
  const dump=[
    'PRAGMA foreign_keys=OFF;',
    'BEGIN TRANSACTION;',
    'CREATE TABLE "synth_events"(event_id TEXT PRIMARY KEY,kind TEXT,payload TEXT);',
    "INSERT INTO \"synth_events\" VALUES('synthetic-0003','delete','SYNTHETIC_ONLY_TOMBSTONE');",
    'COMMIT;'
  ].join('\n');
  const normalized=normalizeSyntheticDumpForQuery(dump);
  assert.ok(normalized.includes('CREATE TABLE "synth_events"'));
  assert.ok(normalized.includes('SYNTHETIC_ONLY_TOMBSTONE'));
  assert.ok(!normalized.includes('BEGIN TRANSACTION'));
  assert.ok(!normalized.includes('COMMIT;'));
  assert.throws(()=>normalizeSyntheticDumpForQuery(dump+'DELETE FROM conversations;'),/unapproved_sql_statement/);
  assert.throws(()=>normalizeSyntheticDumpForQuery(dump.replace('synth_events','users')),/unapproved_sql_statement/);
});
test('realistic synthetic D1 export/restore verifies row digest and deletes only two run-owned D1s',async()=>{
  const f=fakeCloudflare(),messages=[];
  const result=await runSyntheticD1Drill(env(),{fetcher:f.fetcher,log:(...parts)=>messages.push(parts.join(' ')),sleep:async()=>{}});
  assert.equal(result.success,true);
  assert.equal(result.syntheticEvents,4);
  assert.equal(result.deletedTombstonePreserved,true);
  assert.equal(result.syntheticResourcesCleanedUp,true);
  assert.equal(result.customerChatRead,false);
  assert.equal(f.state.size,0,'Must delete BOTH synthetic databases');
  assert.equal(f.calls.filter(x=>x.method==='DELETE').length,2);
  assert.equal(f.metrics().downloads,1);
  assert.ok(!messages.join('\n').includes('?sig='));
  assert.ok(f.calls.every(x=>!x.path.includes(PRIMARY_D1_PIN)));
});
test('foreign signed host fails closed before download and cleans up synthetic source',async()=>{
  const f=fakeCloudflare({unexpectedHost:true});
  await assert.rejects(runSyntheticD1Drill(env(),{fetcher:f.fetcher,log:()=>{},sleep:async()=>{}}),/signed_url_host_not_allowlisted/);
  assert.equal(f.state.size,0);
  assert.equal(f.metrics().downloads,0);
});
test('restore failure still cleans up both synthetic D1 resources',async()=>{
  const f=fakeCloudflare({failRestore:true});
  await assert.rejects(runSyntheticD1Drill(env(),{fetcher:f.fetcher,log:()=>{},sleep:async()=>{}}),/restore_statement_rejected/);
  assert.equal(f.state.size,0);
});
test('no owner approval, wrong account, or non-main GitHub ref blocks without API calls',async()=>{
  for(const mutation of [
    {BOR_SYNTHETIC_OWNER_APPROVAL:'no'},
    {BOR_SYNTHETIC_COST_APPROVED:'false'},
    {CLOUDFLARE_ACCOUNT_ID:'another_account'},
    {GITHUB_REF:'refs/heads/development'},
    {GITHUB_REPOSITORY:'elsewhere/repo'},
    {BOR_PRIVATE_D1_EXPORT_TOKEN:''}
  ]){
    const e={...env(),...mutation};
    let called=false;
    await assert.rejects(runSyntheticD1Drill(e,{fetcher:async()=>{called=true;throw Error('not allowed');}}),/not_owner_approved/);
    assert.equal(called,false);
  }
});
