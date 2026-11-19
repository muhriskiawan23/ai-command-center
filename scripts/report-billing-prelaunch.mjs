#!/usr/bin/env node
// Deterministic NO-SECRETS review, no network, no provider account calls, no checkout.
// The nominal and stress workloads below are explicit scenarios, not actual telemetry.
import {
  assessBillingRelease,auditBillingEconomics,auditMonthlyPortfolio
} from '../src/billing-launch-audit.js';
const common={
  fxIdrPerUsd:'18000.25',
  fxSource:'SYNTHETIC-FX-ILLUSTRATIVE-not-a-live-market-quote',
  gatewayFeesIncludeTax:true,
  aiModel:'gpt-5.4-mini',
  aiInputUsdPerMillion:'0.75',aiOutputUsdPerMillion:'4.50',
  aiRateSource:'https://developers.openai.com/api/docs/models/gpt-5.4-mini',
  tavilyUsdPerCredit:'0.008',
  tavilyRateSource:'https://www.tavily.com/pricing',
  creditFaceMicroUsd:100,
  fxReserveIdr:500,refundReserveIdr:700,otherVariableCostIdr:1000,
  minimumContributionBps:2000
};
const gateways=[
  {gatewayMethod:'VA_BCA_PUBLIC',gatewayFixedFeeIdr:5000,gatewayPercentBps:0},
  {gatewayMethod:'VA_PERMATA_PUBLIC',gatewayFixedFeeIdr:3000,gatewayPercentBps:0},
  {gatewayMethod:'QRIS_PUBLIC',gatewayFixedFeeIdr:0,gatewayPercentBps:70}
];
const plans=[
  {sku:'basic',credits:3000,nominal:{requests:30,inputTokensPerRequest:2000,
    outputTokensPerRequest:800,tavilyBasicSearches:5,tavilyAdvancedSearches:0},
   stress:{requests:100,inputTokensPerRequest:4000,
    outputTokensPerRequest:2500,tavilyBasicSearches:0,tavilyAdvancedSearches:20}},
  {sku:'pro',credits:15000,nominal:{requests:100,inputTokensPerRequest:2000,
    outputTokensPerRequest:800,tavilyBasicSearches:20,tavilyAdvancedSearches:0},
   stress:{requests:400,inputTokensPerRequest:4000,
    outputTokensPerRequest:2500,tavilyBasicSearches:0,tavilyAdvancedSearches:20}}
];
const rows=[];
let basicBca,proBca;
for(const plan of plans){
  for(const gateway of gateways){
    for(const label of ['nominal','stress']){
      const snapshot=auditBillingEconomics({...common,...gateway,
        sku:plan.sku,credits:plan.credits,...plan[label]});
      if(label==='nominal'&&gateway.gatewayMethod==='VA_BCA_PUBLIC'){
        if(plan.sku==='basic')basicBca=snapshot;else proBca=snapshot;
      }
      rows.push({plan:plan.sku,gateway:gateway.gatewayMethod,workload:label,snapshot});
    }
  }
}
const portfolio=auditMonthlyPortfolio({
  basicScenario:basicBca,proScenario:proBca,
  basicSubscribers:70,proSubscribers:30,fixedOperatingCostIdr:2000000
});
const gate=assessBillingRelease({
  idempotentSettlementAndCreditMeteringVerified:false
});
const lines=[
  '# BOR AI BILLING: OFFLINE PRE-LAUNCH AUDIT (NO_GO)',
  'FX 18,000.25 IDR/USD, 3,000/15,000 proposed credits, 100 micro-USD provider budget per credit: ALL illustrative.',
  'Fees: public Duitku estimates, VAT included; actual merchant contract not validated. No second VAT.',
  'AI: published GPT-5.4 mini input $0.75/1M and output $4.50/1M tokens; Tavily PAYG $0.008/credit.',
  'Tavily basic search=1 provider credit; advanced=2. All token and search quantities are SIMULATED.',
  'This report does not assess current GPT-6 pricing, images, voice, other plugins or true API usage.',
  '| Plan | Channel | Usage | IDR gross | Payment fee | Credits used / cap | Contribution IDR | Budget & margin |',
  '|---|---|---|---:|---:|---:|---:|---|',
  ...rows.map(({plan,gateway,workload,snapshot:s})=>
    `| ${plan} | ${gateway} | ${workload} | ${s.quotedIdr} | ${s.gatewayFeeIdr} | ${s.creditsNeeded}/${s.credits} | ${s.contributionIdr} | ${s.scenarioSafe?'scenario PASS':'UNSAFE'} |`),
  '',
  'Portfolio illustration: 70 Basic + 30 Pro users, BCA fee, nominal usage, fixed monthly cost IDR 2,000,000.',
  `Projected contribution before fixed: IDR ${portfolio.preFixedContributionIdr}.`,
  `Projected before-tax operating result AFTER fixed: IDR ${portfolio.beforeTaxOperatingResultIdr}.`,
  `Basic-only break-even customers at assumed fixed overhead: ${portfolio.basicOnlyBreakevenCustomers}.`,
  `Pro-only break-even customers at assumed fixed overhead: ${portfolio.proOnlyBreakevenCustomers}.`,
  '',
  `Release decision: ${gate.status}, reviewed ${gate.reviewedGates}/${gate.totalGates} verified gates.`,
  'Live checkout and real credits DISABLED; do not turn on production in CI or on these estimates.',
  'Missing: Duitku merchant/channel approval, signed live callback first-settlement test, actual provider bills and credit limits, refund/chargeback SOP, contract fee and FX source, operations and rollback.'
];
const report=lines.join('\n');
console.log(report);
if(process.env.GITHUB_STEP_SUMMARY){
  const {appendFileSync}=await import('node:fs');
  appendFileSync(process.env.GITHUB_STEP_SUMMARY,report+'\n');
}
