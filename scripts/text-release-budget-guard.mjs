// Read-only release policy: preserve active text provider mode and do not remove or widen an existing spend cap.
// A provider transition requires its own separately reviewed workflow change.
import {parseUsdMicro} from "../src/credit-metering.js";
const FLAGS=["BOR_TEXT_LUNA_PRIMARY","BOR_TEXT_BACKUP_ENABLED"];
const CAPS=["BOR_TEXT_AI_DAILY_USD_LIMIT","BOR_TEXT_BACKUP_DAILY_USD_LIMIT"];
function flag(value){if(value===undefined)return "false";if(value!=="true"&&value!=="false")throw Error("Unverifiable text provider flag");return value;}
function cap(value){if(value===undefined)return null;const v=parseUsdMicro(value);if(v>BigInt(Number.MAX_SAFE_INTEGER))throw Error("Text spend cap exceeds safe range");return v;}
export function activeTextPolicy(bindings){
 if(!Array.isArray(bindings))throw Error("Missing active text bindings");
 const policy={};
 for(const name of [...FLAGS,...CAPS]){
  const a=bindings.filter(b=>b?.name===name);
  if(a.length>1||(a.length===1&&(a[0].type!=="plain_text"||typeof a[0].text!=="string")))throw Error("Ambiguous active text policy: "+name);
  policy[name]=a.length?a[0].text:null;
 }
 for(const name of FLAGS)flag(policy[name]??undefined);
 for(const name of CAPS)cap(policy[name]??undefined);
 if(policy.BOR_TEXT_LUNA_PRIMARY==="true"&&(policy.BOR_TEXT_BACKUP_ENABLED!=="true"||policy.BOR_TEXT_BACKUP_DAILY_USD_LIMIT===null||policy.BOR_TEXT_AI_DAILY_USD_LIMIT===null))throw Error("Active Luna text policy cannot be safely preserved");
 return policy;
}
export function verifyCandidateTextPolicy(config,policy){
 if(config?.name!=="ai-command-center"||!config.vars||!policy)throw Error("Missing pinned text policy");
 for(const name of FLAGS){
  if(!Object.hasOwn(policy,name)||flag(config.vars[name])!==flag(policy[name]??undefined))throw Error("Unreviewed text provider mode change: "+name);
 }
 for(const name of CAPS){
  if(!Object.hasOwn(policy,name))throw Error("Incomplete active text cap policy");
  const previous=cap(policy[name]??undefined),next=cap(config.vars[name]);
  if(previous!==null&&(next===null||next>previous))throw Error("Active text spend cap removed or widened: "+name);
 }
 return true;
}
export function verifyPlannedTextPolicy(config,policy,env){
 const vars={...config.vars};
 if(env.BOR_TEXT_LUNA_PRIMARY==="true"){
  const limit=cap(env.BOR_TEXT_LUNA_DAILY_USD_LIMIT);
  if(limit===null||limit<=0n||limit>100000n)throw Error("Luna preservation requires reviewed positive cap at most USD 0.10");
  Object.assign(vars,{BOR_TEXT_LUNA_PRIMARY:"true",BOR_TEXT_BACKUP_ENABLED:"true",BOR_TEXT_AI_DAILY_USD_LIMIT:env.BOR_TEXT_LUNA_DAILY_USD_LIMIT,BOR_TEXT_BACKUP_DAILY_USD_LIMIT:env.BOR_TEXT_LUNA_DAILY_USD_LIMIT});
 }else if(env.BOR_TEXT_LUNA_PRIMARY!=="false")throw Error("Unverifiable planned text mode");
 return verifyCandidateTextPolicy({...config,vars},policy);
}
