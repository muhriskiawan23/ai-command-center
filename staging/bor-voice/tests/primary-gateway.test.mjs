import {makePrimaryGateway,connectPrimaryProvider} from '../primary-gateway.mjs';
async function runGatewayTests(make,connectProvider){
  const assert=(v)=>{if(!v)throw Error('assertion failed')};
  function fixture(overrides={}){
    const events=new Map(),sent=[],calls=[],pending=[],settled=[];
    let options;
    const client={readyState:1,send:v=>sent.push(JSON.parse(v)),close(){this.readyState=3},addEventListener:(e,h)=>events.set(e,h),removeEventListener:(e,h)=>{if(events.get(e)===h)events.delete(e)}};
    const provider={close(){calls.push('provider_close')}};
    const deps={getSession:async()=>({id:'owner'}),ownerId:'owner',origin:'https://app.getborai.com',enabled:true,reserve:async()=>{calls.push('reserve');return{ok:true}},connect:async()=>{calls.push('connect');return provider},createVoice:o=>{options=o;calls.push('start');return{close(){calls.push('close')},appendAudio:a=>calls.push('audio:'+a)}},settle:async r=>settled.push(r),waitUntil:p=>pending.push(p),randomId:()=> 'test-attempt-0001',...overrides};
    const request={method:'GET',headers:new Map([['Origin',deps.origin],['Upgrade','websocket']])};
    const start=make(deps);
    return {client,provider,calls,sent,settled,request,start:()=>start(request,client),event:(e,v)=>events.get(e)?.(v),msg:v=>events.get('message')?.({data:JSON.stringify(v)}),finish:r=>options.onFinal(r),audio:d=>options.onAudio(d),flush:()=>Promise.all(pending)};
  }
  const cases=[
    async()=>{let f=fixture({enabled:false});assert(!(await f.start()).ok&&f.calls.length===0)},
    async()=>{let f=fixture({getSession:async()=>({id:'guest'})});assert(!(await f.start()).ok&&f.calls.length===0)},
    async()=>{let f=fixture();f.request.headers.set('Origin','https://other.example');assert(!(await f.start()).ok&&f.calls.length===0)},
    async()=>{let f=fixture({reserve:async()=>({ok:false,reason:'legacy_unconfirmed'})});assert((await f.start()).reason==='legacy_unconfirmed'&&!f.calls.includes('connect'))},
    async()=>{let f=fixture({reserve:async()=>{throw Error()}});assert(!(await f.start()).ok&&!f.calls.includes('connect'))},
    async()=>{let f=fixture();assert((await f.start()).ok&&f.calls.join(',')==='reserve,connect,start')},
    async()=>{let f=fixture();await f.start();f.msg({type:'session.start'});f.msg({type:'audio',audio:'AAAA'});assert(f.calls.filter(x=>x.startsWith('audio:')).join(',')==='audio:AAAA')},
    async()=>{let f=fixture();await f.start();f.msg({type:'stop'});assert(f.calls.at(-1)==='close')},
    async()=>{let f=fixture();await f.start();f.event('close');assert(f.calls.at(-1)==='close')},
    async()=>{let f=fixture();await f.start();f.audio('AAAA');assert(f.sent[0].delta==='AAAA')},
    async()=>{let f=fixture({connect:async()=>{throw Error()}});assert(!(await f.start()).ok);await f.flush();assert(f.settled.length===1&&!f.settled[0].confirmed)},
    async()=>{let f=fixture();await f.start();f.finish({confirmed:true,usage:{seconds:10}});f.finish({confirmed:false});await f.flush();assert(f.settled.length===1&&f.sent.at(-1).confirmed===true)},
    async()=>{let f=fixture({settle:async()=>{throw Error()}});await f.start();f.finish({confirmed:true});await f.flush();assert(f.sent.at(-1).confirmed===false)},
    async()=>{let f=fixture();await f.start();for(let i=0;i<8;i++)f.msg({type:'audio',audio:'A'.repeat(16384)});assert(f.calls.includes('close'))},
    async()=>{let accepted=0;const s={accept(){accepted++}};const r=await connectProvider({apiKey:'test',timeout:()=>null,fetchImpl:async(url,o)=>{assert(url==='https://api.openai.com/v1/live/sessions'&&o.redirect==='manual'&&o.headers.Authorization==='Bearer test');return {status:101,webSocket:s}}});assert(r===s&&accepted===1)},
    async()=>{let rejected=false;try{await connectProvider({apiKey:'test',timeout:()=>null,fetchImpl:async()=>({status:503})})}catch{rejected=true}assert(rejected)}
  ];
  let passed=0;for(const c of cases){await c();passed++}return{passed,total:cases.length}
}
console.log(await runGatewayTests(makePrimaryGateway,connectPrimaryProvider));
