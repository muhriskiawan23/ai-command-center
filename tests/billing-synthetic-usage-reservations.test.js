import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {
  estimateSyntheticCreditHold,readSyntheticSpendableCredits,
  reserveSyntheticCredits,settleSyntheticCredits,releaseSyntheticCredits
} from '../src/billing-synthetic-usage-reservations.js';
import {
  createSyntheticBillingQuote,createSyntheticBillingOrder,
  bindSyntheticInvoiceReference,recordSyntheticBillingEvent,
  recordSyntheticUsageDebit,getBillingWalletAudit
} from '../src/billing-ledger-foundation.js';

const OWNER='STAGE-synthetic-credit-owner-000001';
const OTHER='STAGE-other-credit-owner-000002';
const REQUEST='SYNTH-REQUEST-0000000001';
const NOW=1_800_000_000_000;
// These are scenario rate inputs, not a live model bill or an approved tariff.
const RATES=Object.freeze({
  modelId:'synthetic-mini-demo',rateVersion:'OFFLINE-ONLY-001',
  maxInputTokens:1000,maxOutputTokens:500,maxToolCredits:1,
  inputRateMicroUsdPerMillion:750000n,
  outputRateMicroUsdPerMillion:4500000n,
  toolRateMicroUsdPerCredit:8000n,
  creditValueMicroUsd:100n
});
async function harness(){
  const s=new DatabaseSync(':memory:');
  s.exec('PRAGMA foreign_keys=ON');
  for(const file of [
    '0001_staging_identity.sql','0002_billing_core.sql',
    '0003_invoice_reference_guard.sql','0004_invoice_recovery.sql',
    '0005_daily_invoice_quota.sql','0006_callback_diagnostic_buckets.sql',
    '0007_synthetic_usage_reservations.sql'
  ])s.exec(readFileSync(new URL('../staging/billing/migrations/'+file,import.meta.url),'utf8'));
  const stmt=(query,args=[])=>({
    query,args,
    bind:(...vs)=>stmt(query,vs),
    first:async()=>s.prepare(query).get(...args)??null,
    all:async()=>({results:s.prepare(query).all(...args)}),
    run:async()=>({meta:{changes:Number(s.prepare(query).run(...args).changes)}})
  });
  const db={
    prepare:q=>stmt(q),
    async batch(items){
      s.exec('BEGIN IMMEDIATE');
      try{
        const output=items.map(({query,args})=>s.prepare(query).run(...args));
        s.exec('COMMIT');return output;
      }catch(e){s.exec('ROLLBACK');throw e}
    }
  };
  for(const id of [OWNER,OTHER])
    s.prepare('INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .run(id,id+'@example.invalid','Synthetic','','1800000000000','1800000000000');
  const userId=OWNER,quoteId='BQSTAGE-TEST-000001',orderId='BSTAGE-TEST-000001';
  await createSyntheticBillingQuote(db,{
    quoteId,userId,sku:'basic',proposedCredits:3000,
    proposedTariffVersion:'UNAPPROVED-OFFLINE-001',
    fxIdrPerUsd:'18000.25',fxSource:'offline-fx',issuedAtMs:NOW,
    expiresAtMs:NOW+600000,
    gatewayMethod:'BT',gatewayFeeIdr:4000,gatewayFeeSource:'offline-fee',
    gatewayFeeTaxIdr:480,providerBudgetUsd:'0.30',
    fxReserveIdr:500,refundReserveIdr:700,otherVariableCostsIdr:1000,
    minimumContributionBps:2000
  });
  await createSyntheticBillingOrder(db,{orderId,quoteId,userId,nowMs:NOW});
  await bindSyntheticInvoiceReference(db,{orderId,userId,providerReference:'STAGE-REF-OFFLINE-01'});
  // In-memory synthetic fixture only. No Duitku API request, transaction,
  // real payment confirmation, or real customer credit is issued.
  await recordSyntheticBillingEvent(db,{
    eventKey:'BPE:paid:'+orderId,orderId,eventType:'payment_verified',
    providerReference:'STAGE-REF-OFFLINE-01',amountIdr:35821,checkedAtMs:NOW+1
  });
  return {db,s,userId,orderId,close:()=>s.close()};
}
const reserve=(h,req=REQUEST,tariff=RATES)=>
  reserveSyntheticCredits(h.db,{userId:h.userId,requestId:req,
    nowMs:NOW+2000,...tariff});
const settle=(h,req=REQUEST,params={})=>
  settleSyntheticCredits(h.db,{userId:h.userId,requestId:req,
    nowMs:NOW+3000,measured:true,inputTokens:600,outputTokens:200,
    toolCreditsUsed:1,...params});
const release=(h,req=REQUEST,params={})=>
  releaseSyntheticCredits(h.db,{userId:h.userId,requestId:req,
    nowMs:NOW+4000,verifiedNoProviderCharge:true,...params});

test('worst-case hold reserves model tokens and Tavily tool cost without debiting until measured',async()=>{
  const h=await harness();try{
    const quote=estimateSyntheticCreditHold(RATES);
    assert.equal(quote.maxCostMicroUsd,11000n);
    assert.equal(quote.maxCredits,110);
    assert.equal(quote.liveUsageEnabled,false);
    assert.equal((await reserve(h)).maxCredits,110);
    let available=await readSyntheticSpendableCredits(h.db,{userId:h.userId});
    assert.equal(available.availableCredits,3000);
    assert.equal(available.heldCredits,110);
    assert.equal(available.spendableCredits,2890);
    assert.equal((await getBillingWalletAudit(h.db,h.userId)).availableCredits,3000);
    const finalized=await settle(h);
    assert.equal(finalized.billedCredits,94);
    assert.equal(finalized.releasedUnusedCredits,16);
    assert.equal(finalized.duplicate,false);
    assert.equal(finalized.realCreditsGranted,false);
    available=await readSyntheticSpendableCredits(h.db,{userId:h.userId});
    assert.equal(available.heldCredits,0);
    assert.equal(available.spendableCredits,2906);
    assert.equal(available.reconciled,true);
    const ledger=h.s.prepare("SELECT COUNT(*) AS n,SUM(delta) AS d FROM billing_credit_ledger WHERE event_type='usage'").get();
    assert.equal(ledger.n,1);
    assert.equal(ledger.d,-94);
    assert.equal((await settle(h)).duplicate,true);
    assert.equal(h.s.prepare("SELECT COUNT(*) AS n FROM billing_credit_ledger WHERE event_type='usage'").get().n,1);
    await assert.rejects(()=>settle(h,REQUEST,{inputTokens:601}),/final_state_conflict/);
  }finally{h.close()}
});

test('same request/tariff is idempotent and conflicting tariff or model fails closed',async()=>{
  const h=await harness();try{
    assert.equal((await reserve(h)).duplicate,false);
    assert.equal((await reserve(h)).duplicate,true);
    await assert.rejects(()=>reserve(h,REQUEST,{...RATES,modelId:'different'}),/idempotency_conflict/);
    await assert.rejects(()=>reserve(h,REQUEST,{...RATES,maxOutputTokens:250}),/idempotency_conflict/);
    await assert.rejects(()=>reserveSyntheticCredits(h.db,{
      userId:OTHER,requestId:REQUEST,nowMs:NOW+2000,...RATES
    }),/billing_reserved_credits_insufficient/);
    assert.equal((await readSyntheticSpendableCredits(h.db,{userId:OTHER})).spendableCredits,0);
  }finally{h.close()}
});

test('concurrent separate reservations cannot collectively reserve more than synthetic wallet balance',async()=>{
  const h=await harness();try{
    const params={...RATES,maxInputTokens:0,maxOutputTokens:0,maxToolCredits:1};
    const attempted=await Promise.allSettled(Array.from({length:40},(_,i)=>
      reserve(h,'SYNTH-CONCURRENT-'+String(i).padStart(4,'0'),params)));
    const successful=attempted.filter(r=>r.status==='fulfilled');
    const rejected=attempted.filter(r=>r.status==='rejected');
    assert.equal(successful.length,37);
    assert.equal(rejected.length,3);
    assert.ok(rejected.every(r=>/billing_reserved_credits_insufficient/.test(String(r.reason))));
    const wallet=await readSyntheticSpendableCredits(h.db,{userId:h.userId});
    assert.equal(wallet.heldCredits,2960);
    assert.equal(wallet.spendableCredits,40);
  }finally{h.close()}
});

test('legacy synthetic usage debit cannot consume credits reserved for another in-flight request',async()=>{
  const h=await harness();try{
    await reserve(h,REQUEST,{...RATES,maxInputTokens:0,maxOutputTokens:0,maxToolCredits:37});
    const before=await readSyntheticSpendableCredits(h.db,{userId:h.userId});
    assert.equal(before.spendableCredits,40);
    await assert.rejects(()=>recordSyntheticUsageDebit(h.db,{
      userId:h.userId,requestId:'SYNTH-UNRESERVED-SPEND-001',credits:41,
      createdAtMs:NOW+3500
    }),/billing_reserved_credits_insufficient/);
    await recordSyntheticUsageDebit(h.db,{
      userId:h.userId,requestId:'SYNTH-UNRESERVED-SPEND-002',credits:40,
      createdAtMs:NOW+3501
    });
    assert.equal((await readSyntheticSpendableCredits(h.db,{userId:h.userId})).spendableCredits,0);
    assert.equal((await release(h)).status,'released');
    assert.equal((await readSyntheticSpendableCredits(h.db,{userId:h.userId})).spendableCredits,2960);
  }finally{h.close()}
});

test('only verified zero-provider-charge can release; replay release cannot debit and settled cannot be released',async()=>{
  const h=await harness();try{
    await reserve(h);
    await assert.rejects(()=>release(h,REQUEST,{verifiedNoProviderCharge:false}),/verified zero charge/);
    await assert.rejects(()=>release(h,REQUEST,{nowMs:NOW+1000}),/precedes reservation/);
    assert.equal((await release(h)).duplicate,false);
    assert.equal((await release(h)).duplicate,true);
    await assert.rejects(()=>settle(h),/final_state_conflict/);
    assert.equal(h.s.prepare("SELECT COUNT(*) AS n FROM billing_credit_ledger WHERE event_type='usage'").get().n,0);
    await reserve(h,'SYNTH-SETTLED-REQUEST-01');
    await settle(h,'SYNTH-SETTLED-REQUEST-01');
    await assert.rejects(()=>release(h,'SYNTH-SETTLED-REQUEST-01'),/final_state_conflict/);
  }finally{h.close()}
});

test('unmeasured, oversize and forged metering cannot debit; zero usage settles without ledger row',async()=>{
  const h=await harness();try{
    await reserve(h);
    await assert.rejects(()=>settle(h,REQUEST,{measured:false}),/metering must be measured/);
    await assert.rejects(()=>settle(h,REQUEST,{outputTokens:501}),/exceeds reserved maximum/);
    await assert.rejects(()=>settle(h,REQUEST,{toolCreditsUsed:2}),/exceeds reserved maximum/);
    await assert.rejects(()=>settle(h,REQUEST,{inputTokens:-1}),/bounded nonnegative/);
    await assert.rejects(()=>settle(h,REQUEST,{nowMs:NOW+1000}),/precedes reservation/);
    const untouched=await readSyntheticSpendableCredits(h.db,{userId:h.userId});
    assert.equal(untouched.spendableCredits,2890);
    const zero=await settle(h,REQUEST,{inputTokens:0,outputTokens:0,toolCreditsUsed:0});
    assert.equal(zero.status,'settled');
    assert.equal(zero.billedCredits,0);
    assert.equal(zero.releasedUnusedCredits,110);
    assert.equal(h.s.prepare("SELECT COUNT(*) AS n FROM billing_credit_ledger WHERE event_type='usage'").get().n,0);
    assert.equal((await readSyntheticSpendableCredits(h.db,{userId:h.userId})).spendableCredits,3000);
  }finally{h.close()}
});

test('rate gaps, unbounded output, zero-cost tool and oversized quote never obtain reservation',async()=>{
  const bad=[
    {...RATES,maxOutputTokens:1_000_000_001},
    {...RATES,maxInputTokens:-1},{...RATES,maxToolCredits:0,maxInputTokens:0,maxOutputTokens:0},
    {...RATES,toolRateMicroUsdPerCredit:0n},
    {...RATES,inputRateMicroUsdPerMillion:0n},
    {...RATES,outputRateMicroUsdPerMillion:null},
    {...RATES,creditValueMicroUsd:0n},
    {...RATES,rateVersion:''},{...RATES,modelId:''},
    {...RATES,toolRateMicroUsdPerCredit:BigInt(Number.MAX_SAFE_INTEGER)+1n},
    {...RATES,creditValueMicroUsd:1n,maxToolCredits:1000000000,
      toolRateMicroUsdPerCredit:1000000000n}
  ];
  for(const value of bad)assert.throws(()=>estimateSyntheticCreditHold(value));
});

test('immutable terminal reservation rows cannot be rewritten/deleted or reused for another financial event',async()=>{
  const h=await harness();try{
    await reserve(h);await settle(h);
    assert.throws(()=>h.s.prepare(
      "UPDATE billing_usage_reservations SET max_credits=999 WHERE user_id=? AND request_id=?"
    ).run(h.userId,REQUEST),/reservation_immutable/);
    assert.throws(()=>h.s.prepare(
      'DELETE FROM billing_usage_reservations WHERE user_id=? AND request_id=?'
    ).run(h.userId,REQUEST),/append_only/);
    assert.equal((await getBillingWalletAudit(h.db,h.userId)).reconciled,true);
  }finally{h.close()}
});

test('mock chargeback after reservation blocks further measured debit, but hold can be released',async()=>{
  const h=await harness();try{
    await reserve(h);
    // Synthetic reversal fixture only; not money movement or verified Duitku refund.
    await recordSyntheticBillingEvent(h.db,{
      eventKey:'BPE:refund:'+h.orderId,orderId:h.orderId,eventType:'refund_verified',
      providerReference:'STAGE-REF-OFFLINE-01',amountIdr:35821,checkedAtMs:NOW+2200
    });
    await assert.rejects(()=>settle(h),/billing_insufficient_or_frozen|billing_reserved_credits_insufficient/);
    const row=h.s.prepare("SELECT status FROM billing_usage_reservations WHERE user_id=? AND request_id=?")
      .get(h.userId,REQUEST);
    assert.equal(row.status,'held');
    assert.equal((await release(h)).status,'released');
    assert.equal((await getBillingWalletAudit(h.db,h.userId)).availableCredits,0);
  }finally{h.close()}
});
