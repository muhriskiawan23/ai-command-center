// BOR AI Google-session-bound billing account READ-ONLY SHADOW.
// Not a commercial wallet and NEVER returns usable paid entitlements.
// Deliberately OFF by default. No Duitku calls, DB writes or credit grants.
// A separate HMAC-protected subject avoids storing Google IDs/emails in billing.
const SCOPE='bor-ai-billing-shadow-subject-v1|';
const EXPECTED_DB='bor-ai-billing-shadow';
const ALLOWED=new Set(['not_enrolled','under_review','blocked']);
const HEADERS={
  'Cache-Control':'private, no-store, max-age=0',
  'Pragma':'no-cache',
  'X-Content-Type-Options':'nosniff',
  'Content-Type':'application/json;charset=utf-8'
};
function respond(status,body){
  return new Response(JSON.stringify(body),{status,headers:HEADERS});
}
function unavailable(status=503,code='billing_shadow_unavailable'){
  return respond(status,{error:code,productionCheckoutEnabled:false,
    realCreditsGranted:false,realSubscriptionEnabled:false});
}
export async function deriveShadowSubject(userId,pepper){
  if(typeof userId!=='string'||!/^\d{6,255}$/.test(userId))
    throw new TypeError('verified Google subject required');
  if(typeof pepper!=='string'||pepper.length<32||pepper.length>512)
    throw new TypeError('independent billing shadow identity pepper required');
  const encoding=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoding.encode(pepper),
    {name:'HMAC',hash:'SHA-256'},false,['sign']);
  const digest=await crypto.subtle.sign('HMAC',key,encoding.encode(SCOPE+userId));
  return Array.from(new Uint8Array(digest),v=>v.toString(16).padStart(2,'0')).join('');
}
export async function handleBillingShadowAccountRequest(request,env,{getSession}={}){
  // NEVER accept tenant IDs, model prices, 'credits', or tokens from a client.
  // Also refuse requests with a query string, which could become a privacy
  // leak in access logs and tempt later business logic to trust client input.
  const url=new URL(request.url);
  if(url.pathname!=='/api/billing/account')return unavailable(404,'not_found');
  if(env?.BOR_BILLING_SHADOW_ENABLED!=='true')return unavailable(404,'not_found');
  if(request.method!=='GET')return unavailable(405,'method_not_allowed');
  const site=request.headers.get('Sec-Fetch-Site');
  const origin=request.headers.get('Origin');
  // The endpoint is read-only, but do not allow future callers to treat a
  // cross-origin response as an account selector, even from sibling domains.
  if(url.search||url.hash||
    (site && site!=='same-origin' && site!=='none')||
    (origin && origin!==url.origin))
    return unavailable(403,'billing_shadow_forbidden');
  if(typeof getSession!=='function')return unavailable();
  let user;
  try{user=await getSession(request,env)}
  catch{return unavailable()}
  if(!user)return unavailable(401,'authentication_required');
  // A malformed verified-subject shape is not silently treated as another
  // tenant. Google OIDC 'sub' is a numeric stable ID; never substitute email.
  if(typeof user.id!=='string'||!/^\d{6,255}$/.test(user.id))
    return unavailable();
  if(env.BOR_BILLING_SHADOW_D1_NAME!==EXPECTED_DB||
    !env.BILLING_SHADOW_DB?.prepare||
    env.BILLING_SHADOW_DB===env.DB||
    typeof env.BOR_BILLING_SHADOW_PEPPER!=='string')
    return unavailable();
  try{
    // Attestation prevents accidental use of the real chat D1 or the existing
    // Duitku sandbox D1 even if an operator misconfigures a binding name.
    const attestation=await env.BILLING_SHADOW_DB.prepare(
      'SELECT service,database_name,schema_version FROM billing_shadow_attestation WHERE id=1'
    ).first();
    if(attestation?.service!=='bor-billing-shadow-readonly'||
      attestation.database_name!==EXPECTED_DB||
      attestation.schema_version!==1)
      return unavailable();
    const subject=await deriveShadowSubject(user.id,env.BOR_BILLING_SHADOW_PEPPER);
    const row=await env.BILLING_SHADOW_DB.prepare(
      'SELECT status FROM billing_shadow_accounts WHERE subject_hash=?'
    ).bind(subject).first();
    const status=row?.status??'not_enrolled';
    if(!ALLOWED.has(status))return unavailable();
    // This endpoint is a noncommercial readiness lookup. Deliberately no
    // real balance, plan, order, Google ID/email, subject hash or paid status.
    return respond(200,{
      accountStatus:status,source:'read_only_isolated_shadow',
      billingReady:false,commercialEntitlement:false,credits:null,
      productionCheckoutEnabled:false,realCreditsGranted:false,
      realSubscriptionEnabled:false
    });
  }catch{
    // Never reveal SQL/table names, identities or database content.
    return unavailable();
  }
}
