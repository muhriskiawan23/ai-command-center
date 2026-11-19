// BOR AI dedicated BILLING STAGING Worker; separate D1, separate secrets, no real credits.
// Never import this file into the production Worker. All invoices are Duitku SANDBOX only.
// Staging sessions are operator-issued synthetic identities, NOT production Google users.
import { sha256Hex } from './http.js';
import { duitkuSignature } from './duitku-sandbox-worker.js';
import { createDuitkuV2SandboxAdapter } from './duitku-v2-sandbox-contract.js';
import {
  startOfflineDuitkuCheckout, verifyOfflineDuitkuCallback,
  readOfflineCustomerOrder, resolveOfflineBillingSession
} from './billing-synthetic-gateway-bridge.js';
import { getBillingWalletAudit } from './billing-ledger-foundation.js';

const PREFIX='/api/billing-sandbox';
const COOKIE='__Host-bor_billing_stage';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ORDER=/^BSTAGE-[a-f0-9]{40}$/;
const HEADERS={'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
class StageError extends Error {
  constructor(status,code){super(code);this.status=status;this.code=code}
}
function fail(status,code){throw new StageError(status,code)}
function json(body,status=200,headers={}){
  return new Response(JSON.stringify(body),{status,headers:{...HEADERS,'Content-Type':'application/json;charset=utf-8',...headers}});
}
function secretEqual(a,b){
  if(typeof a!=='string'||typeof b!=='string'||a.length!==b.length)return false;
  let diff=0;for(let i=0;i<a.length;i++)diff|=a.charCodeAt(i)^b.charCodeAt(i);
  return diff===0;
}
function origin(env){
  const u=new URL(env.STAGING_PUBLIC_ORIGIN);
  if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||u.search||u.hash)
    fail(503,'invalid_staging_origin');
  return u.origin;
}
function ready(env){
  return env.BILLING_STAGING_ENABLED==='true'&&env.BILLING_STAGING_ALLOW_TEST_INVOICES==='true'&&
    env.STAGING_D1_NAME==='bor-ai-billing-staging'&&!!env.BILLING_DB&&
    /^DS\d+$/.test(env.DUITKU_SANDBOX_MERCHANT_CODE||'')&&
    typeof env.DUITKU_SANDBOX_API_KEY==='string'&&env.DUITKU_SANDBOX_API_KEY.length>=10&&
    typeof env.BILLING_STAGING_OPERATOR_TOKEN==='string'&&env.BILLING_STAGING_OPERATOR_TOKEN.length>=32&&
    typeof env.BILLING_STAGING_CSRF_SECRET==='string'&&env.BILLING_STAGING_CSRF_SECRET.length>=32;
}
function authorizedOperator(request,env){
  const provided=request.headers.get('Authorization')||'';
  if(!secretEqual(provided,'Bearer '+env.BILLING_STAGING_OPERATOR_TOKEN))fail(401,'operator_auth_required');
}
function sameOrigin(request,env){
  if(request.headers.get('Origin')!==origin(env))fail(403,'same_origin_required');
  if(request.headers.get('Sec-Fetch-Site')==='cross-site')fail(403,'cross_site_forbidden');
}
function getCookie(request){
  const raw=request.headers.get('Cookie')||'';
  const candidate=raw.split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'='));
  const val=candidate?.slice(COOKIE.length+1)||'';
  return /^[A-Za-z0-9_-]{40,128}$/.test(val)?val:null;
}
async function readBounded(request,limit){
  const declared=Number(request.headers.get('Content-Length')||0);
  if(declared>limit)fail(413,'request_too_large');
  const reader=request.body?.getReader();
  if(!reader)fail(400,'request_body_required');
  let length=0;const parts=[];
  for(;;){
    const {done,value}=await reader.read();
    if(done)break;
    length+=value.byteLength;
    if(length>limit){await reader.cancel();fail(413,'request_too_large')}
    parts.push(value);
  }
  const bytes=new Uint8Array(length);let offset=0;
  for(const part of parts){bytes.set(part,offset);offset+=part.length}
  try{return new TextDecoder('utf-8',{fatal:true}).decode(bytes)}
  catch{fail(400,'invalid_utf8')}
}
async function body(request,limit=2048){
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('Content-Type')||''))fail(415,'json_required');
  try{
    const value=JSON.parse(await readBounded(request,limit));
    if(!value||typeof value!=='object'||Array.isArray(value))fail(400,'invalid_json');
    return value;
  }catch(e){if(e instanceof StageError)throw e;fail(400,'invalid_json')}
}
async function formBody(request){
  if(!/^application\/x-www-form-urlencoded(?:;|$)/i.test(request.headers.get('Content-Type')||''))
    fail(415,'form_required');
  return new URLSearchParams(await readBounded(request,4096));
}
function numberConfig(env,name,minimum=0){
  const value=env[name];
  if(typeof value!=='string'||!/^(0|[1-9]\d{0,9})$/.test(value))fail(503,'staging_policy_unavailable');
  const parsed=Number(value);
  if(!Number.isSafeInteger(parsed)||parsed<minimum)fail(503,'staging_policy_unavailable');
  return parsed;
}
function stringConfig(env,name){
  const s=env[name];
  if(typeof s!=='string'||!s.trim()||s.length>128)fail(503,'staging_policy_unavailable');
  return s;
}
function policy(env,sku,nowMs){
  if(!['basic','pro'].includes(sku))fail(400,'sku_not_available_in_staging');
  const version=stringConfig(env,'STAGING_TEST_TARIFF_VERSION');
  const fx=stringConfig(env,'STAGING_TEST_FX_IDR_PER_USD');
  const budget=stringConfig(env,sku==='basic'?'STAGING_TEST_PROVIDER_BUDGET_BASIC_USD':'STAGING_TEST_PROVIDER_BUDGET_PRO_USD');
  return {
    sku,proposedCredits:numberConfig(env,sku==='basic'?'STAGING_TEST_BASIC_CREDITS':'STAGING_TEST_PRO_CREDITS',1),
    proposedTariffVersion:version,fxIdrPerUsd:fx,fxSource:'operator-synthetic-fx-no-live-market-rate',
    issuedAtMs:nowMs,expiresAtMs:nowMs+10*60*1000,
    gatewayMethod:'BT',
    gatewayFeeIdr:numberConfig(env,'STAGING_TEST_GATEWAY_FEE_IDR'),
    gatewayFeeSource:'operator-synthetic-fee-not-merchant-contract',
    gatewayFeeTaxIdr:numberConfig(env,'STAGING_TEST_GATEWAY_FEE_TAX_IDR'),
    providerBudgetUsd:budget,
    fxReserveIdr:numberConfig(env,'STAGING_TEST_FX_RESERVE_IDR'),
    refundReserveIdr:numberConfig(env,'STAGING_TEST_REFUND_RESERVE_IDR'),
    otherVariableCostsIdr:numberConfig(env,'STAGING_TEST_OTHER_COST_IDR'),
    minimumContributionBps:numberConfig(env,'STAGING_TEST_MIN_CONTRIBUTION_BPS')
  };
}
function provider(env){
  return createDuitkuV2SandboxAdapter({
    merchantCode:env.DUITKU_SANDBOX_MERCHANT_CODE,
    apiKey:env.DUITKU_SANDBOX_API_KEY,
    publicBaseUrl:origin(env),
    fetcher:env.DUITKU_SANDBOX_FETCHER||fetch
  });
}
async function auth(request,env,nowMs){
  const token=getCookie(request);
  if(!token)fail(401,'staging_login_required');
  let userId;
  try{userId=await resolveOfflineBillingSession(env.BILLING_DB,{sessionToken:token,nowMs})}
  catch{fail(401,'staging_login_required')}
  return {userId,token};
}
async function csrf(token,env){
  return sha256Hex('billing-stage-csrf|'+token+'|'+env.BILLING_STAGING_CSRF_SECRET);
}
async function requireCsrf(request,env,token){
  sameOrigin(request,env);
  if(!secretEqual(request.headers.get('X-BOR-Billing-CSRF'),await csrf(token,env)))
    fail(403,'csrf_mismatch');
}
async function createStageSession(env,nowMs){
  const db=env.BILLING_DB;
  const userId='STAGE-'+crypto.randomUUID();
  const sessionToken=crypto.randomUUID().replace(/-/g,'')+crypto.randomUUID().replace(/-/g,'');
  const tokenHash=await sha256Hex(sessionToken);
  const expiresAt=Math.floor(nowMs/1000)+3600;
  const email=userId.toLowerCase()+'@example.invalid';
  // All 3 statements are committed atomically via a D1 batch. No PII used.
  await db.batch([
    db.prepare('INSERT INTO users(id,email,name,picture,created_at,updated_at) VALUES(?,?,?,?,?,?)')
      .bind(userId,email,'Test Account','',nowMs,nowMs),
    db.prepare('INSERT INTO sessions(token_hash,user_id,expires_at,created_at) VALUES(?,?,?,?)')
      .bind(tokenHash,userId,expiresAt,nowMs),
    db.prepare('INSERT INTO staging_session_issue_log(id,user_id,created_at) VALUES(?,?,?)')
      .bind('ISSUE-'+crypto.randomUUID(),userId,nowMs)
  ]);
  return json({sandbox:true,accountType:'operator_issued_synthetic',userId,
    expiresAt,realCreditsGranted:false,realPaymentsEnabled:false},201,{
    'Set-Cookie':COOKIE+'='+sessionToken+'; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=3600'
  });
}
async function orderAudit(env,orderId){
  if(!ORDER.test(orderId))fail(400,'invalid_order_id');
  const order=await env.BILLING_DB.prepare(
    'SELECT o.id,o.status,o.user_id,o.quote_id,o.provider_reference,q.quoted_idr,q.proposed_credits FROM billing_orders o JOIN billing_quotes q ON q.id=o.quote_id WHERE o.id=?'
  ).bind(orderId).first();
  if(!order)fail(404,'order_not_found');
  const l=await env.BILLING_DB.prepare(
    "SELECT COUNT(*) AS n,COALESCE(SUM(delta),0) AS credits FROM billing_credit_ledger WHERE order_id=? AND event_type='grant'"
  ).bind(orderId).first();
  const wallet=await getBillingWalletAudit(env.BILLING_DB,order.user_id);
  return json({sandbox:true,orderId,status:order.status,amountIdr:order.quoted_idr,
    expectedCredits:order.proposed_credits,ledgerEntries:l?.n??0,ledgerCredits:l?.credits??0,
    walletReconciled:wallet.reconciled,realCreditsGranted:false});
}
async function operatorReconcile(env,orderId,nowMs){
  if(!ORDER.test(orderId))fail(400,'invalid_order_id');
  const order=await env.BILLING_DB.prepare(
    'SELECT o.id,o.status,o.provider_reference,q.quoted_idr FROM billing_orders o JOIN billing_quotes q ON q.id=o.quote_id WHERE o.id=?'
  ).bind(orderId).first();
  if(!order)fail(404,'order_not_found');
  if(!order.provider_reference)fail(409,'invoice_reference_unresolved');
  if(order.status!=='pending')return orderAudit(env,orderId);
  // Server-signed internal callback triggers the SAME verification and D1
  // idempotency path as an external Duitku callback. No fake status allowed.
  const amount=String(order.quoted_idr),merchant=env.DUITKU_SANDBOX_MERCHANT_CODE;
  const signature=await duitkuSignature(env.DUITKU_SANDBOX_API_KEY,merchant+amount+orderId);
  const callback=new URLSearchParams({
    merchantCode:merchant,amount,merchantOrderId:orderId,
    reference:order.provider_reference,resultCode:'01',signature
  });
  const result=await verifyOfflineDuitkuCallback({
    db:env.BILLING_DB,callback,provider:provider(env),merchantCode:merchant,
    apiKey:env.DUITKU_SANDBOX_API_KEY,nowMs
  });
  if(result.status==='pending')return json({sandbox:true,orderId,status:'pending',realCreditsGranted:false},202);
  if(result.status==='provider_failed')return json({sandbox:true,orderId,status:'provider_failed',realCreditsGranted:false},200);
  return orderAudit(env,orderId);
}
// Only static diagnostic categories are ever logged: no callback body,
// transaction identifiers, headers, signatures, payment URLs or provider payloads.
const CALLBACK_REJECTION_CODES=new Set([
  'form_required','request_too_large','request_body_required','invalid_utf8',
  'invalid_callback_body','invalid_callback_fields','invalid_callback_parameters',
  'invalid_provider_amount','invalid_callback_signature','merchant_mismatch',
  'callback_order_amount_or_reference_mismatch','unbound_synthetic_invoice',
  'authentication_required','sandbox_status_retry_later',
  'duitku_sandbox_unavailable','duitku_sandbox_status_mismatch',
  'provider_status_mismatch','wallet_reconciliation_failed'
]);
function logSafeCallbackFailure(error){
  const code=error instanceof Error ? error.message : '';
  const category=CALLBACK_REJECTION_CODES.has(code)?code:'other';
  console.warn('bor_billing_staging_callback_rejected',{category});
}
export default {
  async fetch(request,env){
    try{
      const u=new URL(request.url),nowMs=Date.now(),method=request.method;
      if(u.pathname==='/health'&&method==='GET')return json({
        sandbox:true,isolatedBilling:true,configured:ready(env),productionCheckoutEnabled:false,
        realCreditsGranted:false
      });
      if(!ready(env))fail(503,'billing_staging_disabled');
      if(u.origin!==origin(env))fail(403,'unexpected_staging_origin');
      if(u.pathname===PREFIX+'/return'&&method==='GET')
        return json({sandbox:true,message:'Return URL is not payment proof. Verify via operator status check.',realCreditsGranted:false});
      if(u.pathname===PREFIX+'/callback'){
        if(method!=='POST')fail(405,'post_required');
        const result=await verifyOfflineDuitkuCallback({
          db:env.BILLING_DB,callback:await formBody(request),provider:provider(env),
          merchantCode:env.DUITKU_SANDBOX_MERCHANT_CODE,
          apiKey:env.DUITKU_SANDBOX_API_KEY,nowMs
        });
        if(result.status==='pending')return json({sandbox:true,received:false,retry:true},503,{'Retry-After':'30'});
        return json({sandbox:true,received:true,realCreditsGranted:false});
      }
      if(u.pathname===PREFIX+'/operator/session'){
        if(method!=='POST')fail(405,'post_required');
        authorizedOperator(request,env);
        return createStageSession(env,nowMs);
      }
      if(u.pathname===PREFIX+'/operator/audit'){
        if(method!=='GET')fail(405,'get_required');
        authorizedOperator(request,env);
        return orderAudit(env,u.searchParams.get('orderId')||'');
      }
      if(u.pathname===PREFIX+'/operator/reconcile'){
        if(method!=='POST')fail(405,'post_required');
        authorizedOperator(request,env);
        const data=await body(request);
        if(Object.keys(data).join(',')!=='orderId')fail(400,'invalid_body_fields');
        return operatorReconcile(env,data.orderId,nowMs);
      }
      if(u.pathname===PREFIX+'/me'){
        if(method!=='GET')fail(405,'get_required');
        const {userId,token}=await auth(request,env,nowMs);
        const wallet=await getBillingWalletAudit(env.BILLING_DB,userId);
        return json({sandbox:true,userId,csrfToken:await csrf(token,env),
          availableTestCredits:wallet.availableCredits,debtTestCredits:wallet.debtCredits,
          reconciled:wallet.reconciled,realCreditsGranted:false});
      }
      if(u.pathname===PREFIX+'/checkout'){
        if(method!=='POST')fail(405,'post_required');
        const {userId,token}=await auth(request,env,nowMs);
        await requireCsrf(request,env,token);
        const data=await body(request);
        if(Object.keys(data).sort().join(',')!=='requestId,sku'||!UUID.test(data.requestId))
          fail(400,'checkout_request_invalid');
        if(!['basic','pro'].includes(data.sku))fail(400,'sku_not_available_in_staging');
        const idHash=await sha256Hex(userId+'|'+data.requestId);
        const quoteId='BQSTAGE-'+idHash.slice(0,40),orderId='BSTAGE-'+idHash.slice(0,40);
        const checkout=await startOfflineDuitkuCheckout({
          db:env.BILLING_DB,sessionToken:token,sku:data.sku,quoteId,orderId,
          nowMs,merchantCode:env.DUITKU_SANDBOX_MERCHANT_CODE,
          provider:provider(env),policyForSku:async(sku,nowMs)=>policy(env,sku,nowMs)
        });
        // Return only SANDBOX payment links. Never entitle a real user.
        return json({sandbox:true,orderId:checkout.orderId,quoteId:checkout.quoteId,
          status:checkout.status,amountIdr:checkout.amountIdr,
          paymentUrl:checkout.paymentUrl??null,duplicate:checkout.duplicate,
          realCreditsGranted:false,productionCheckoutEnabled:false},checkout.duplicate?200:201);
      }
      const orderMatch=new RegExp('^'+PREFIX+'/orders/(BSTAGE-[a-f0-9]{40})$').exec(u.pathname);
      if(orderMatch){
        if(method!=='GET')fail(405,'get_required');
        const {token}=await auth(request,env,nowMs);
        const order=await readOfflineCustomerOrder({db:env.BILLING_DB,sessionToken:token,
          orderId:orderMatch[1],nowMs});
        return json({...order,realCreditsGranted:false});
      }
      fail(404,'not_found');
    }catch(error){
      if(new URL(request.url).pathname===PREFIX+'/callback')logSafeCallbackFailure(error);
      if(error instanceof StageError)return json({sandbox:true,error:error.code},error.status);
      const msg=String(error?.message||'');
      // Never disclose provider secret, signed payload, customer identity or raw SQL.
      if(msg.includes('authentication_required'))return json({sandbox:true,error:'staging_login_required'},401);
      if(msg.includes('order_not_found'))return json({sandbox:true,error:'order_not_found'},404);
      if(msg.includes('sandbox_status_retry_later')||msg.includes('staging_daily_checkout_limit')||msg.includes('staging_daily_session_limit'))
        return json({sandbox:true,error:msg.includes('retry_later')?'status_retry_later':'staging_daily_limit'},429,{'Retry-After':'30'});
      if(msg.includes('margin')||msg.includes('staging_policy')||msg.includes('invalid_server_pricing'))
        return json({sandbox:true,error:'staging_policy_unavailable'},503);
      if(msg.includes('duitku_sandbox_unavailable'))return json({sandbox:true,error:'provider_unavailable'},502);
      if(msg.includes('request_too_large'))return json({sandbox:true,error:'request_too_large'},413);
      if(msg.includes('idempotency_conflict')||msg.includes('invoice_reference_conflict'))
        return json({sandbox:true,error:'order_conflict'},409);
      if(msg.includes('signature'))return json({sandbox:true,error:'invalid_signature'},403);
      if(msg.includes('invalid_callback')||msg.includes('callback_order')||msg.includes('merchant_mismatch'))
        return json({sandbox:true,error:'invalid_callback'},400);
      return json({sandbox:true,error:'billing_staging_unavailable'},503);
    }
  }
};
