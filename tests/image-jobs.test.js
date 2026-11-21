import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';
import { createD1, seedSession } from './e2e/harness.js';
import { processImageJob, cleanupImageJobs } from '../src/image-jobs.js';
import { imageIntent } from '../public/image-intent.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGMUaTrxnwEJMDGgAcICAJqcAmUgQSjSAAAAAElFTkSuQmCC','base64');
const photo='data:image/png;base64,'+png.toString('base64');
function setup(){
 const db=createD1(); const user={id:'image-user',email:'image@example.test'}; const token=seedSession(db,user);
 db.sqlite.prepare('INSERT INTO image_wallets VALUES (?,?,?)').run(user.id,100,1);
 const files=new Map(),sent=[],calls=[];
 const env={DB:db,BOR_IMAGES_ENABLED:'true',OPENAI_API_KEY:'secret-never-leak',IMAGE_CREDITS_GENERATE:'10',IMAGE_CREDITS_EDIT:'12',IMAGE_TARIFF_VERSION:'test-v1',CHAT_LIMITER:{limit:async()=>({success:true})},
 OPENAI_IMAGE_MODEL:'gpt-image-2',IMAGE_PILOT_QUALITY:'low',IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT:'10',
 IMAGE_FILES:{async put(key,bytes){files.set(key,Buffer.from(bytes));},async get(key){const value=files.get(key);return value?{body:value,arrayBuffer:async()=>value.buffer.slice(value.byteOffset,value.byteOffset+value.byteLength)}:null;},async delete(keys){for(const key of Array.isArray(keys)?keys:[keys])files.delete(key);}},
 IMAGE_QUEUE:{send:async body=>sent.push(body)},IMAGE_FETCHER:async(url,options)=>{calls.push({url,options});return Response.json({data:[{b64_json:png.toString('base64')}],usage:{input_tokens:20,output_tokens:30,total_tokens:50}});}};
 const request=(path,body,headers={})=>new Request('https://bor.test'+path,{method:body?'POST':'GET',headers:{Cookie:'__Host-borai_session='+token,...(body?{'Content-Type':'application/json',Origin:'https://bor.test'}:{}),...headers},...(body?{body:JSON.stringify(body)}:{})});
 const create=overrides=>worker.fetch(request('/api/images/jobs',{mode:'generate',prompt:'Buat poster',tariffVersion:'test-v1',maxCredits:overrides?.mode==='edit'?12:10,requestId:crypto.randomUUID(),...overrides}),env);
 return {db,env,files,sent,calls,request,create,close:()=>db.sqlite.close()};
}
test('intent separates questions, analysis, generation and edits',()=>{
 for(const prompt of ['Ini foto apa?','Apa yang salah dari screenshot ini?','Bagaimana cara membuat poster?','Jelaskan cara hapus background']) assert.equal(imageIntent(prompt,true),null,prompt);
 for(const prompt of ['Ubah kualitas foto ini jadi HD','hapus background','Edit foto ini','Buat HD']) assert.equal(imageIntent(prompt,true),'edit',prompt);
 for(const prompt of ['Edit gagal sementara.','Tolong edit jawaban ini.']) assert.equal(imageIntent(prompt,false),null);
 assert.equal(imageIntent('Buat poster promo top up game'), 'generate');
 assert.equal(imageIntent('Buat poster dari foto ini',true),'edit');
 assert.equal(imageIntent('Buat poster',false,'analyze'),null);
});
test('job lifecycle reserves once, processes once, stores private downloadable bytes',async()=>{
 const h=setup();try{
 const requestId=crypto.randomUUID();const response=await h.create({requestId});assert.equal(response.status,202);const job=await response.json();assert.equal(job.status,'queued');
 assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,90);
 const replay=await h.create({requestId});assert.equal((await replay.json()).id,job.id);assert.equal(h.sent.length,1);
 const conflict=await h.create({requestId,prompt:'different'});assert.equal(conflict.status,409);
 await Promise.all([processImageJob(h.env,job.id),processImageJob(h.env,job.id)]);assert.equal(h.calls.length,1);
 const completed=await (await worker.fetch(h.request('/api/images/jobs/'+job.id),h.env)).json();assert.equal(completed.status,'completed');assert.equal(completed.files[0].mimeType,'image/png');
 const download=await worker.fetch(h.request(completed.files[0].downloadUrl),h.env);assert.equal(download.status,200);assert.match(download.headers.get('Content-Disposition'),/^attachment/);assert.equal(download.headers.get('Cache-Control'),'private, no-store');assert.deepEqual(Buffer.from(await download.arrayBuffer()),png);
 const ledger=h.db.sqlite.prepare('SELECT * FROM image_credit_ledger').all();assert.equal(ledger.length,1);assert.equal(ledger[0].job_id,job.id);
 assert.equal(JSON.parse(h.db.sqlite.prepare('SELECT usage_json FROM image_jobs').get().usage_json).total_tokens,50);
 }finally{h.close();}
});
test('edits send original pixels as multipart and delete source after completion',async()=>{
 const h=setup();try{const job=await (await h.create({mode:'edit',sourceImage:photo})).json();assert.equal(h.files.size,1);await processImageJob(h.env,job.id);assert.equal(h.files.size,1);assert.match(h.calls[0].url,/images\/edits$/);const form=h.calls[0].options.body;assert.ok(form instanceof FormData);assert.deepEqual(Buffer.from(await form.get('image').arrayBuffer()),png);
 const follow=await h.create({mode:'edit',sourceJobId:job.id});assert.equal(follow.status,202);
 }finally{h.close();}
});
test('provider failures refund exactly once and hide provider secrets',async()=>{
 const h=setup();try{h.env.IMAGE_FETCHER=async()=>{throw Error('secret-never-leak private prompt');};const job=await (await h.create()).json();await processImageJob(h.env,job.id);await processImageJob(h.env,job.id);const failed=await (await worker.fetch(h.request('/api/images/jobs/'+job.id),h.env)).json();assert.equal(failed.status,'failed');assert.doesNotMatch(JSON.stringify(failed),/secret-never-leak/);assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,100);assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM image_credit_ledger WHERE event='refund'").get().n,1);
 }finally{h.close();}
});
test('credit and daily admission fail closed, no queue call or negative balance',async()=>{
 const h=setup();try{h.db.sqlite.prepare('UPDATE image_wallets SET balance=10').run();const results=await Promise.all([h.create(),h.create()]);assert.deepEqual(results.map(r=>r.status).sort(),[202,402]);assert.equal(h.sent.length,1);assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,0);
 h.db.sqlite.prepare('UPDATE image_wallets SET balance=100').run();h.env.IMAGE_DAILY_LIMIT_USER='1';assert.equal((await h.create()).status,429);assert.equal(h.sent.length,1);
 }finally{h.close();}
});
test('authorization, CSRF, disabled feature and malformed inputs cannot spend credits',async()=>{
 const h=setup();try{
 assert.equal((await worker.fetch(h.request('/api/images/jobs',{},{Cookie:''}),h.env)).status,401);
 assert.equal((await worker.fetch(h.request('/api/images/jobs',{},{Origin:'https://evil.test'}),h.env)).status,403);
 h.env.BOR_IMAGES_ENABLED='false';assert.equal((await h.create()).status,503);h.env.BOR_IMAGES_ENABLED='true';
 assert.equal((await h.create({mode:'edit'})).status,400);assert.equal((await h.create({mode:'edit',sourceImage:'data:image/png;base64,YWJjZA=='})).status,400);
 assert.equal((await h.create({outputFormat:'svg'})).status,400);assert.equal(h.sent.length,0);
 }finally{h.close();}
});
test('other users cannot read job, download, reuse output or delete result',async()=>{
 const h=setup();try{const job=await (await h.create()).json();await processImageJob(h.env,job.id);const token=seedSession(h.db,{id:'other',email:'other@example.test'});const Cookie='__Host-borai_session='+token;
 for(const path of ['/api/images/jobs/'+job.id,'/api/files/'+job.id+'/download']) assert.equal((await worker.fetch(h.request(path,null,{Cookie}),h.env)).status,404);
 const reuse=await worker.fetch(h.request('/api/images/jobs',{mode:'edit',prompt:'Edit',tariffVersion:'test-v1',maxCredits:12,requestId:crypto.randomUUID(),sourceJobId:job.id},{Cookie}),h.env);assert.equal(reuse.status,404);
 const remove=new Request('https://bor.test/api/images/jobs/'+job.id,{method:'DELETE',headers:{Cookie,Origin:'https://bor.test'}});assert.equal((await worker.fetch(remove,h.env)).status,404);assert.equal(h.files.size,1);
 }finally{h.close();}
});
test('stale processing is refunded with no provider retry; expired files are removed',async()=>{
 const h=setup();try{const job=await (await h.create()).json();h.db.sqlite.prepare("UPDATE image_jobs SET status='processing',updated_at=1 WHERE id=?").run(job.id);await cleanupImageJobs(h.env);await processImageJob(h.env,job.id);assert.equal(h.calls.length,0);assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,100);
 const other=await (await h.create()).json();await processImageJob(h.env,other.id);h.db.sqlite.prepare('UPDATE image_jobs SET expires_at=1 WHERE id=?').run(other.id);assert.equal((await worker.fetch(h.request('/api/files/'+other.id+'/download'),h.env)).status,410);await cleanupImageJobs(h.env);assert.equal(h.files.size,0);
 }finally{h.close();}
});
test('queue outage refunds an unclaimed job and duplicate deliveries stay failed',async()=>{
 const h=setup();try{h.env.IMAGE_QUEUE.send=async()=>{throw Error('queue');};const job=await (await h.create()).json();assert.equal(job.status,'failed');await processImageJob(h.env,job.id);assert.equal(h.calls.length,0);assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,100);
 }finally{h.close();}
});

test('changed credit quote is rejected without reserving money',async()=>{
 const h=setup();try{const res=await h.create({maxCredits:1});assert.equal(res.status,409);assert.equal((await res.json()).code,'image_tariff_changed');assert.equal(h.sent.length,0);assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,100);}finally{h.close();}
});
test('credit grants are auditable and idempotent by payment/operator reference',()=>{
 const h=setup();try{const grant=h.db.sqlite.prepare("INSERT INTO image_credit_ledger(user_id,event,delta,reference,created_at) VALUES(?,'grant',25,'synthetic-payment-123',1) ON CONFLICT(reference) DO NOTHING");grant.run('image-user');grant.run('image-user');assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,125);assert.equal(h.db.sqlite.prepare("SELECT COUNT(*) AS n FROM image_credit_ledger WHERE event='grant'").get().n,1);}finally{h.close();}
});
test('lost database acknowledgement after completion cannot delete a successful output',async()=>{
 const h=setup();try{const job=await (await h.create()).json();const original=h.env.DB.prepare;h.env.DB.prepare=sql=>{const statement=original(sql);if(!sql.startsWith("UPDATE image_jobs SET status='completed'"))return statement;return {bind(...args){const bound=statement.bind(...args);return {async run(){await bound.run();throw Error('lost acknowledgement');}};}};};await processImageJob(h.env,job.id);assert.equal(h.db.sqlite.prepare('SELECT status FROM image_jobs').get().status,'completed');assert.equal(h.files.size,1);assert.equal(h.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance,90);}finally{h.close();}
});
test('oversized or invalid provider output cannot become a successful downloadable file',async()=>{
 const h=setup();try{h.env.IMAGE_FETCHER=async()=>Response.json({data:[{b64_json:Buffer.from('<svg onload="evil"/>').toString('base64')}]});const job=await (await h.create()).json();await processImageJob(h.env,job.id);const row=h.db.sqlite.prepare('SELECT * FROM image_jobs').get();assert.equal(row.status,'failed');assert.equal(row.error_code,'invalid_provider_output');assert.equal(h.files.size,0);}finally{h.close();}
});

test('OpenAI pilot rejects unapproved model, quality and missing attempt ceiling before any provider call',async()=>{
 const h=setup();try{
 for(const [key,value] of [['IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT',undefined],['IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT','11'],['OPENAI_IMAGE_MODEL','gpt-image-2.5-sunburst'],['IMAGE_PILOT_QUALITY','medium']]){
  const original=h.env[key];if(value===undefined)delete h.env[key];else h.env[key]=value;
  const result=await h.create();assert.equal(result.status,503,`${key}=${value}`);
  h.env[key]=original;
 }
 assert.equal(h.sent.length,0);
 }finally{h.close();}
});
test('pilot lifetime cap counts admitted attempts across days including failed jobs',async()=>{
 const h=setup();try{
 h.env.IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT='2';
 const first=await h.create();const second=await h.create();
 assert.equal(first.status,202);assert.equal(second.status,202);
 const refused=await h.create();assert.equal(refused.status,429);
 assert.equal(h.sent.length,2);
 // A failed request still counts: upstream may have charged even if no image was delivered.
 await h.db.sqlite.prepare("UPDATE image_jobs SET status='failed' WHERE id=?").bind((await first.json()).id).run();
 const refusedAgain=await h.create();assert.equal(refusedAgain.status,429);
 assert.equal(h.calls.length,0);
 }finally{h.close();}
});
test('pilot provider request is a single low-quality square image',async()=>{
 const h=setup();try{
 const job=await (await h.create()).json();await processImageJob(h.env,job.id);
 assert.equal(h.calls.length,1);
 const body=JSON.parse(h.calls[0].options.body);
 assert.equal(body.model,'gpt-image-2');assert.equal(body.quality,'low');
 assert.equal(body.size,'1024x1024');assert.equal(body.n,1);
 }finally{h.close();}
});
