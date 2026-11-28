import test from "node:test";
import assert from "node:assert/strict";
import { readExternalWithBackup } from "../src/url-reader-fallback.js";

const env = {URL_READER_ENABLED:"true",URL_READER_PROVIDER:"railway",URL_READER_TAVILY_FALLBACK_ENABLED:"true",TAVILY_EXTRACT_DAILY_URL_LIMIT:"8",TAVILY_EXTRACT_FETCHER:()=>{},DB:{}};
const urls = ["https://example.com/a","https://example.com/b"];
const cases = [
 ["primary healthy",{},[0,0,null]],
 ["only failed URL",{mode:"temporary"},[1,1,"8"]],
 ["security failure",{mode:"security"},[0,0,null]],
 ["redirect hop failure",{mode:"redirect"},[0,0,null]],
 ["backup flag off",{mode:"temporary",env:{URL_READER_TAVILY_FALLBACK_ENABLED:"false"}},[0,0,null]],
 ["reader off",{mode:"temporary",env:{URL_READER_ENABLED:"false"}},[0,0,null]],
 ["missing binding",{noPrimary:true},[0,0,null]],
 ["cap clamped",{mode:"temporary",env:{TAVILY_EXTRACT_DAILY_URL_LIMIT:"100"}},[1,1,"8"]],
 ["zero cap",{mode:"temporary",env:{TAVILY_EXTRACT_DAILY_URL_LIMIT:"0"}},[0,0,null]],
 ["backup failure no retry",{mode:"temporary",throwBackup:true},[1,0,"8"]]
];
for (const [name,options,expected] of cases) test(name, async () => {
  const calls=[];
  const fail=Object.assign(new Error("temporary"),{code:"EGRESS_TEMPORARY_UNAVAILABLE"});
  const primary=options.noPrimary?null:async u=>{
    if(options.mode==="temporary"&&u.endsWith("/b"))throw fail;
    if(options.mode==="security")throw Error("proxy_security_proof_missing");
    if(options.mode==="redirect"&&u.endsWith("/b"))throw fail;
    return {ok:true};
  };
  const output=await readExternalWithBackup(urls,{...env,...options.env},{
    makeFetcher:()=>primary,
    read:async(u,{fetcher})=>{
      try {
        if(!fetcher)return {ok:false};
        await fetcher(options.mode==="redirect"?"https://example.com/a":u);
        if(options.mode==="redirect")await fetcher("https://example.com/b");
        return {ok:true,url:u};
      } catch {return {ok:false,url:u};}
    },
    extract:async(us,e)=>{
      calls.push({urls:us,limit:e.TAVILY_EXTRACT_DAILY_URL_LIMIT});
      if(options.throwBackup)throw Error("backup_down");
      return us.map(u=>({ok:true,url:u,provider:"tavily"}));
    }
  });
  assert.deepEqual([calls.length,output.filter(x=>x.provider==="tavily").length,calls[0]?.limit||null],expected);
  if(calls.length)assert.deepEqual(calls[0].urls,[urls[1]]);
});
