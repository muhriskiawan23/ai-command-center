import test from "node:test";
import assert from "node:assert/strict";
import {activeTextPolicy,verifyCandidateTextPolicy,verifyPlannedTextPolicy} from "../scripts/text-release-budget-guard.mjs";
const vars={BOR_TEXT_LUNA_PRIMARY:"true",BOR_TEXT_BACKUP_ENABLED:"true",BOR_TEXT_AI_DAILY_USD_LIMIT:"0.10",BOR_TEXT_BACKUP_DAILY_USD_LIMIT:"0.10"};
const bindings=Object.entries(vars).map(([name,text])=>({name,type:"plain_text",text}));
const policy=activeTextPolicy(bindings),config={name:"ai-command-center",vars:{}};
test("existing Luna and equal or lower daily caps can be preserved",()=>{
 assert.equal(verifyPlannedTextPolicy(config,policy,{BOR_TEXT_LUNA_PRIMARY:"true",BOR_TEXT_LUNA_DAILY_USD_LIMIT:"0.10"}),true);
 assert.equal(verifyPlannedTextPolicy(config,policy,{BOR_TEXT_LUNA_PRIMARY:"true",BOR_TEXT_LUNA_DAILY_USD_LIMIT:"0.05"}),true);
 assert.equal(verifyCandidateTextPolicy({...config,vars},policy),true);
});
test("reject Luna disable, missing or widened caps and unreviewed activation",()=>{
 assert.throws(()=>verifyPlannedTextPolicy(config,policy,{BOR_TEXT_LUNA_PRIMARY:"false"}));
 for(const v of [undefined,"0.11","invalid","0"])assert.throws(()=>verifyPlannedTextPolicy(config,policy,{BOR_TEXT_LUNA_PRIMARY:"true",BOR_TEXT_LUNA_DAILY_USD_LIMIT:v}));
 for(const name of ["BOR_TEXT_AI_DAILY_USD_LIMIT","BOR_TEXT_BACKUP_DAILY_USD_LIMIT"]){
  const missing={...vars};delete missing[name];
  assert.throws(()=>verifyCandidateTextPolicy({...config,vars:missing},policy));
  assert.throws(()=>verifyCandidateTextPolicy({...config,vars:{...vars,[name]:"0.11"}},policy));
 }
 assert.throws(()=>verifyPlannedTextPolicy(config,activeTextPolicy([]),{BOR_TEXT_LUNA_PRIMARY:"true",BOR_TEXT_LUNA_DAILY_USD_LIMIT:"0.10"}));
});
test("ambiguous or missing active Luna policy fails closed",()=>{
 assert.throws(()=>activeTextPolicy([...bindings,bindings[0]]));
 assert.throws(()=>activeTextPolicy(bindings.filter(b=>b.name!=="BOR_TEXT_AI_DAILY_USD_LIMIT")));
 assert.throws(()=>activeTextPolicy(bindings.map(b=>b.name==="BOR_TEXT_BACKUP_DAILY_USD_LIMIT"?{...b,text:0.1}:b)));
 assert.throws(()=>verifyCandidateTextPolicy({...config,vars},{...policy,BOR_TEXT_AI_DAILY_USD_LIMIT:"invalid"}));
});
