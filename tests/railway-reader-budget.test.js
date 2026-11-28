import test from "node:test";
import assert from "node:assert/strict";
import { reserveRailwayHop } from "../src/railway-reader-budget.js";
const env={URL_READER_ENABLED:"true",URL_READER_PROVIDER:"railway",RAILWAY_READER_DAILY_HOP_LIMIT:"50",DB:{prepare(){}}};
const day="2026-11-28";
const scenarios=[
 ["admit",{},()=>1,null],
 ["at cap",{},()=>null,"railway_daily_hop_cap"],
 ["missing DB",{DB:null},()=>1,"railway_budget_not_configured"],
 ["disabled",{URL_READER_ENABLED:"false"},()=>1,"railway_budget_not_configured"],
 ["bad limit",{RAILWAY_READER_DAILY_HOP_LIMIT:"0"},()=>1,"railway_budget_not_configured"],
 ["too high",{RAILWAY_READER_DAILY_HOP_LIMIT:"1001"},()=>1,"railway_budget_not_configured"],
 ["DB error",{},()=>{throw Error("db")},"railway_budget_unavailable"],
 ["invalid receipt",{},()=>51,"railway_budget_invalid"]
];
for(const [name,over,answer,want] of scenarios)test(name,async()=>{
 const work=()=>reserveRailwayHop({...env,...over},{day,consume:async(e,d,s,n,l)=>{assert.equal(d,day);assert.equal(s,"provider:railway-reader:global");assert.equal(n,1);assert.equal(l,50);return answer();}});
 if(want)await assert.rejects(work,{message:want});else assert.equal(await work(),1);
});
