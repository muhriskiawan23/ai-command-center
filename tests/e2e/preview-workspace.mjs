// Local visual review only. Ephemeral SQLite and synthetic AI; no paid services.
import {startHarness} from './harness.js';
const flag=process.argv.indexOf('--port');
const port=Number(flag>=0?process.argv[flag+1]:(process.env.PORT||5173));
const app=await startHarness({port});
app.env.ASSETS=(()=>{const original=app.env.ASSETS;return{async fetch(request){
 const response=await original.fetch(request);
 if(new URL(request.url).pathname==='/'||new URL(request.url).pathname==='/index.html'){
  const html=(await response.text()).replace('https://accounts.google.com/gsi/client','/preview-gsi-stub.js');
  return new Response(html,{headers:response.headers,status:response.status});
 }
 if(new URL(request.url).pathname==='/preview-gsi-stub.js')return new Response('window.google={accounts:{id:{initialize(){},renderButton(el){el.textContent="Google sign-in (preview)"},disableAutoSelect(){}}}}',{headers:{'content-type':'text/javascript'}});
 return response;
}}})();
console.log('Local: '+app.url);
const keepAlive=setInterval(()=>{},1000);
await new Promise(resolve=>{
 for(const signal of ['SIGINT','SIGTERM'])process.once(signal,async()=>{clearInterval(keepAlive);await app.close();resolve();});
});
