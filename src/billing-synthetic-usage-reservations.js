// BOR AI OFFLINE/STAGING-ONLY credit holds for synthetic AI and tool requests.
// Not imported by production Worker, not exposed via HTTP, not tied to real
// customer accounts and never calls any provider. Explicit versioned rates and
// worst-case max output + tool cost are required before *hypothetical* dispatch.
import {calculateProviderCostMicroUsd} from './credit-metering.js';
import {getBillingWalletAudit} from './billing-ledger-foundation.js';

const ID=/^[A-Za-z0-9:_-]{10,160}$/;
const ceilDiv=(a,b)=>(a+b-1n)/b;
function safeInteger(v,name,max=1_000_000_000){
  if(!Number.isSafeInteger(v)||v<0||v>max)
    throw new TypeError(name+' must be a bounded nonnegative safe integer');
  return v;
}
function nonempty(v,name,max=128){
  if(typeof v!=='string'||!v.trim()||v.length>max)
    throw new TypeError(name+' must be a bounded nonempty string');
  return v;
}
function identity(userId,requestId){
  nonempty(userId,'userId',255);
  if(typeof requestId!=='string'||!ID.test(requestId))
    throw new TypeError('requestId must be an ASCII id 10..160 chars');
}
function positiveRate(v,name){
  if(typeof v!=='bigint'||v<=0n||v>BigInt(Number.MAX_SAFE_INTEGER))
    throw new TypeError(name+' must be a verified positive bigint micro-USD rate');
  return v;
}
function currentTime(ms){
  safeInteger(ms,'nowMs',Number.MAX_SAFE_INTEGER);
  return ms;
}
function costFor(p,input,output,toolCredits){
  return calculateProviderCostMicroUsd({
    inputTokens:input,outputTokens:output,
    inputRateMicroUsdPerMillion:BigInt(p.inputRateMicroUsdPerMillion),
    outputRateMicroUsdPerMillion:BigInt(p.outputRateMicroUsdPerMillion)
  }) + BigInt(toolCredits)*BigInt(p.toolRateMicroUsdPerCredit);
}
const fields=['modelId','rateVersion','maxInputTokens','maxOutputTokens',
  'maxToolCredits','inputRateMicroUsdPerMillion','outputRateMicroUsdPerMillion',
  'toolRateMicroUsdPerCredit','creditValueMicroUsd','maxCredits'];
function sameQuote(record,quote){
  return record.model_id===quote.modelId&&record.rate_version===quote.rateVersion&&
    record.max_input_tokens===quote.maxInputTokens&&
    record.max_output_tokens===quote.maxOutputTokens&&
    record.max_tool_credits===quote.maxToolCredits&&
    record.input_rate_micro_usd===Number(quote.inputRateMicroUsdPerMillion)&&
    record.output_rate_micro_usd===Number(quote.outputRateMicroUsdPerMillion)&&
    record.tool_rate_micro_usd===Number(quote.toolRateMicroUsdPerCredit)&&
    record.credit_value_micro_usd===Number(quote.creditValueMicroUsd)&&
    record.max_credits===quote.maxCredits;
}
function readReservation(db,userId,requestId){
  return db.prepare('SELECT * FROM billing_usage_reservations WHERE user_id=? AND request_id=?')
    .bind(userId,requestId).first();
}
export function estimateSyntheticCreditHold({
  modelId,rateVersion,maxInputTokens,maxOutputTokens,maxToolCredits,
  inputRateMicroUsdPerMillion,outputRateMicroUsdPerMillion,
  toolRateMicroUsdPerCredit,creditValueMicroUsd
}){
  nonempty(modelId,'modelId');
  nonempty(rateVersion,'rateVersion');
  const input=safeInteger(maxInputTokens,'maxInputTokens');
  const output=safeInteger(maxOutputTokens,'maxOutputTokens');
  const tool=safeInteger(maxToolCredits,'maxToolCredits');
  const inputRate=positiveRate(inputRateMicroUsdPerMillion,'inputRate');
  const outputRate=positiveRate(outputRateMicroUsdPerMillion,'outputRate');
  const toolRate=positiveRate(toolRateMicroUsdPerCredit,'toolRate');
  const perCredit=positiveRate(creditValueMicroUsd,'creditValue');
  if(input+output+tool===0)throw new TypeError('a zero-cost request cannot be dispatched');
  const maximumMicro=costFor({inputRateMicroUsdPerMillion:inputRate,
    outputRateMicroUsdPerMillion:outputRate,toolRateMicroUsdPerCredit:toolRate},
    input,output,tool);
  const maximumCredits=ceilDiv(maximumMicro,perCredit);
  if(maximumCredits<1n||maximumCredits>1_000_000_000n)
    throw new RangeError('reservation exceeds maximum synthetic credits');
  return Object.freeze({
    modelId,rateVersion,maxInputTokens:input,maxOutputTokens:output,
    maxToolCredits:tool,inputRateMicroUsdPerMillion:inputRate,
    outputRateMicroUsdPerMillion:outputRate,toolRateMicroUsdPerCredit:toolRate,
    creditValueMicroUsd:perCredit,maxCostMicroUsd:maximumMicro,
    maxCredits:Number(maximumCredits),liveUsageEnabled:false
  });
}
export async function readSyntheticSpendableCredits(db,{userId}){
  nonempty(userId,'userId',255);
  const wallet=await getBillingWalletAudit(db,userId);
  const row=await db.prepare(
    "SELECT COALESCE(SUM(max_credits),0) AS n FROM billing_usage_reservations WHERE user_id=? AND status='held'"
  ).bind(userId).first();
  const held=row?.n??0;
  if(!Number.isSafeInteger(held)||held<0||held>wallet.availableCredits)
    throw new Error('synthetic_reservation_wallet_mismatch');
  return Object.freeze({
    userId,availableCredits:wallet.availableCredits,
    heldCredits:held,spendableCredits:wallet.debtCredits>0?0:wallet.availableCredits-held,
    debtCredits:wallet.debtCredits,reconciled:wallet.reconciled,
    synthetic:true,realCreditsGranted:false
  });
}
export async function reserveSyntheticCredits(db,{
  userId,requestId,nowMs,...tariff
}){
  identity(userId,requestId);
  currentTime(nowMs);
  const quote=estimateSyntheticCreditHold(tariff);
  let record=await readReservation(db,userId,requestId);
  if(record){
    if(!sameQuote(record,quote))throw new Error('synthetic_reservation_idempotency_conflict');
    return Object.freeze({requestId,status:record.status,maxCredits:record.max_credits,
      duplicate:true,synthetic:true,realCreditsGranted:false});
  }
  try{
    await db.prepare(`INSERT INTO billing_usage_reservations(
      user_id,request_id,model_id,rate_version,
      max_input_tokens,max_output_tokens,max_tool_credits,
      input_rate_micro_usd,output_rate_micro_usd,tool_rate_micro_usd,
      credit_value_micro_usd,max_credits,status,held_at
    ) VALUES(?,?,?,?,?,?,?,?,?,?,?,?, 'held',?)`).bind(
      userId,requestId,quote.modelId,quote.rateVersion,
      quote.maxInputTokens,quote.maxOutputTokens,quote.maxToolCredits,
      Number(quote.inputRateMicroUsdPerMillion),
      Number(quote.outputRateMicroUsdPerMillion),
      Number(quote.toolRateMicroUsdPerCredit),
      Number(quote.creditValueMicroUsd),quote.maxCredits,nowMs
    ).run();
  }catch(e){
    // Concurrent same-request retry may have already committed its hold.
    record=await readReservation(db,userId,requestId);
    if(!record||!sameQuote(record,quote))throw e;
    return Object.freeze({requestId,status:record.status,maxCredits:record.max_credits,
      duplicate:true,synthetic:true,realCreditsGranted:false});
  }
  return Object.freeze({requestId,status:'held',maxCredits:quote.maxCredits,
    duplicate:false,synthetic:true,realCreditsGranted:false});
}
export async function settleSyntheticCredits(db,{
  userId,requestId,nowMs,measured,inputTokens,outputTokens,toolCreditsUsed
}){
  identity(userId,requestId);
  currentTime(nowMs);
  if(measured!==true)throw new TypeError('provider metering must be measured');
  const input=safeInteger(inputTokens,'inputTokens');
  const output=safeInteger(outputTokens,'outputTokens');
  const tool=safeInteger(toolCreditsUsed,'toolCreditsUsed');
  const r=await readReservation(db,userId,requestId);
  if(!r)throw new Error('synthetic_reservation_not_found');
  if(input>r.max_input_tokens||output>r.max_output_tokens||
    tool>r.max_tool_credits)
    throw new RangeError('measured usage exceeds reserved maximum; do not dispatch additional calls');
  const cost=costFor({
    inputRateMicroUsdPerMillion:BigInt(r.input_rate_micro_usd),
    outputRateMicroUsdPerMillion:BigInt(r.output_rate_micro_usd),
    toolRateMicroUsdPerCredit:BigInt(r.tool_rate_micro_usd)
  },input,output,tool);
  const charged=Number(ceilDiv(cost,BigInt(r.credit_value_micro_usd)));
  if(charged>r.max_credits)throw new RangeError('measured cost exceeds reserved credits');
  const result=(final,duplicate)=>Object.freeze({
    requestId,status:final.status,billedCredits:final.finalized_credits,
    releasedUnusedCredits:final.max_credits-final.finalized_credits,
    duplicate,synthetic:true,realCreditsGranted:false
  });
  const terminalMatches=final=>final.status==='settled'&&
    final.billed_input_tokens===input&&final.billed_output_tokens===output&&
    final.billed_tool_credits===tool&&final.finalized_credits===charged;
  if(r.status!=='held'){
    if(!terminalMatches(r))throw new Error('synthetic_reservation_final_state_conflict');
    return result(r,true);
  }
  if(nowMs<r.held_at)throw new TypeError('finalization precedes reservation');
  // D1 batch is one transaction. Hold is released and the exact measured
  // ledger debit is committed together. Other reservations cannot see a
  // temporary free balance and borrow it before this debit is recorded.
  const update=db.prepare(`UPDATE billing_usage_reservations
    SET status='settled',finalized_at=?,billed_input_tokens=?,
    billed_output_tokens=?,billed_tool_credits=?,finalized_credits=?
    WHERE user_id=? AND request_id=? AND status='held'`).bind(
    nowMs,input,output,tool,charged,userId,requestId
  );
  const debit=db.prepare(`INSERT INTO billing_credit_ledger(
    id,user_id,order_id,event_type,source_key,delta,created_at)
    SELECT ?,user_id,NULL,'usage',request_id,?,?
    FROM billing_usage_reservations r
    WHERE r.user_id=? AND r.request_id=? AND r.status='settled'
      AND r.finalized_credits=? AND r.finalized_credits>0
      AND NOT EXISTS(SELECT 1 FROM billing_credit_ledger l
        WHERE l.user_id=r.user_id AND l.event_type='usage'
          AND l.source_key=r.request_id)`).bind(
    'BLEDGER:usage:'+crypto.randomUUID(),-charged,nowMs,
    userId,requestId,charged
  );
  await db.batch([update,debit]);
  const final=await readReservation(db,userId,requestId);
  if(!terminalMatches(final))throw new Error('synthetic_reservation_final_state_conflict');
  const entries=await db.prepare(`SELECT COUNT(*) AS n,COALESCE(SUM(delta),0) AS total
    FROM billing_credit_ledger WHERE user_id=? AND event_type='usage' AND source_key=?`)
    .bind(userId,requestId).first();
  if(entries?.n!==(charged>0?1:0)||entries?.total!==-charged)
    throw new Error('synthetic_reservation_ledger_mismatch');
  return result(final,false);
}
export async function releaseSyntheticCredits(db,{
  userId,requestId,nowMs,verifiedNoProviderCharge
}){
  identity(userId,requestId);
  currentTime(nowMs);
  if(verifiedNoProviderCharge!==true)
    throw new TypeError('do not release uncertain provider usage without verified zero charge');
  const before=await readReservation(db,userId,requestId);
  if(!before)throw new Error('synthetic_reservation_not_found');
  if(before.status==='settled')throw new Error('synthetic_reservation_final_state_conflict');
  if(before.status==='released')return Object.freeze({
    requestId,status:'released',duplicate:true,synthetic:true,realCreditsGranted:false
  });
  if(nowMs<before.held_at)throw new TypeError('release precedes reservation');
  await db.prepare(`UPDATE billing_usage_reservations
    SET status='released',finalized_at=?
    WHERE user_id=? AND request_id=? AND status='held'`)
    .bind(nowMs,userId,requestId).run();
  const after=await readReservation(db,userId,requestId);
  if(after?.status!=='released')throw new Error('synthetic_reservation_final_state_conflict');
  return Object.freeze({
    requestId,status:'released',duplicate:false,synthetic:true,realCreditsGranted:false
  });
}
