// Bounded operational diagnostic. No user content, model text, cookies or secret values are printed.
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm,open} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const account=process.env.CLOUDFLARE_ACCOUNT_ID,token=process.env.CLOUDFLARE_API_TOKEN;
if(!account||!token)throw Error('Diagnostic credentials unavailable');
const output={direct:null,chat:null,trace:null};
try{
 const response=await fetch('https://api.cloudflare.com/client/v4/accounts/'+encodeURIComponent(account)+'/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast',{
  method:'POST',headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
  body:JSON.stringify({messages:[{role:'user',content:'Say hello.'}],max_tokens:64,stream:false}),signal:AbortSignal.timeout(30000)});
 const payload=await response.json();
 const value=payload.result;
 output.direct={status:response.status,errorCode:Number.isInteger(payload.errors?.[0]?.code)?payload.errors[0].code:null,
  resultType:typeof value,hasResponse:typeof value?.response==='string',hasOutputText:typeof value?.output_text==='string',
  hasChoices:Array.isArray(value?.choices),hasOutput:Array.isArray(value?.output),hasAnswer:typeof value?.answer==='string'};
}catch(error){output.direct={transport:error.name};}
const folder=await mkdtemp(join(tmpdir(),'bor-chat-diagnostic-'));
const file=join(folder,'tail.json');
const fd=await open(file,'w');
let tail;
try{
 tail=spawn('npx',['--yes','wrangler@4','tail','ai-command-center','--format','json'],{stdio:['ignore',fd.fd,'ignore']});
 await new Promise(resolve=>setTimeout(resolve,8000));
 const marker=crypto.randomUUID();
 const url='https://ai-command-center.muhriskiawan23.workers.dev/api/chat?bor_diagnostic='+marker;
 const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'hi bor',agent:'coordinator',language:'id'}),signal:AbortSignal.timeout(60000)});
 const body=await response.json();
 output.chat={status:response.status,code:typeof body.code==='string'?body.code:null,hasAnswer:typeof body.response==='string'&&body.response.trim().length>0};
 await new Promise(resolve=>setTimeout(resolve,5000));
 tail.kill('SIGTERM');await new Promise(resolve=>setTimeout(resolve,1000));
 const raw=await readFile(file,'utf8');
 // Wrangler emits successive pretty-printed JSON objects. Extract complete top-level objects.
 let start=-1,depth=0,quoted=false,escaped=false;
 const events=[];
 for(let i=0;i<raw.length;i++){
  const c=raw[i];
  if(quoted){if(escaped)escaped=false;else if(c==='\\\\')escaped=true;else if(c==='"')quoted=false;continue;}
  if(c==='"'){quoted=true;continue;}
  if(c==='{'){if(depth===0)start=i;depth++;}
  if(c==='}'){depth--;if(depth===0&&start>=0){try{events.push(JSON.parse(raw.slice(start,i+1)));}catch{}start=-1;}}
 }
 const event=events.find(x=>x.event?.request?.url===url);
 if(event){
  const messages=(event.logs||[]).flatMap(log=>log.message||[]);
  output.trace={outcome:event.outcome,telemetry:messages.filter(x=>x&&typeof x==='object'&&x.event==='BOR_AI_MODEL_TELEMETRY').map(x=>({outcome:x.outcome,attempts:x.attempts,attemptOutcomes:x.attemptOutcomes,failureType:x.failureType,modelId:x.modelId})),
   safeErrors:messages.filter(x=>x&&typeof x==='object'&&typeof x.name==='string').map(x=>x.name).slice(0,3)};
 }else output.trace={matched:false,tailExited:tail.exitCode};
}catch(error){output.trace={diagnosticError:error.name};}
finally{tail?.kill('SIGTERM');await fd.close();await rm(folder,{recursive:true,force:true});}
console.log('BOR_CHAT_DIAGNOSTIC '+JSON.stringify(output));
