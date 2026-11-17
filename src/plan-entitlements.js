// INACTIVE BOR AI tier gate. Pure policy + future server-verifiable paid
// entitlement source. Never trust a browser-selected price, plan or credits.
// Free baseline remains unchanged, including specialist and multi-agent modes.
export const PLAN_ORDER = Object.freeze(["free","basic","pro"]);
const RANK = Object.freeze({free:0,basic:1,pro:2});
const FEATURE_LEVELS = Object.freeze({
  chat: "free",
  specialist_agents: "free",
  multi_agent: "free",
  signed_in_history: "free",
  basic_paid_credits: "basic",
  credit_topups: "basic",
  pro_credit_capacity: "pro",
  pro_rollover_eligibility: "pro" // eligibility only; actual rollover requires finance approval
});
export const PLAN_FEATURE_LEVELS = FEATURE_LEVELS;

const SQL = `
SELECT e.paid_tier, e.status AS entitlement_status, e.starts_at, e.ends_at,
       p.verification_status AS payment_status, p.verified_at,
       s.selected_tier
FROM (SELECT ? AS user_id) subject
LEFT JOIN plan_entitlements e ON e.user_id=subject.user_id
LEFT JOIN verified_plan_payments p
  ON p.order_id=e.payment_order_id
 AND p.user_id=e.user_id AND p.purchased_tier=e.paid_tier
LEFT JOIN plan_selections s ON s.user_id=subject.user_id
`;
const SELECTION_SQL = `
INSERT INTO plan_selections (user_id, selected_tier, updated_at)
SELECT ?, ?, ?
WHERE ?='free' OR EXISTS (
  SELECT 1 FROM plan_entitlements e
  INNER JOIN verified_plan_payments p
    ON p.order_id=e.payment_order_id
   AND p.user_id=e.user_id AND p.purchased_tier=e.paid_tier
  WHERE e.user_id=? AND e.status='active'
    AND p.verification_status='verified_paid' AND p.verified_at <= ?
    AND e.starts_at <= ? AND e.ends_at > ?
    AND (e.paid_tier='pro' OR (e.paid_tier='basic' AND ?='basic'))
)
ON CONFLICT(user_id) DO UPDATE
SET selected_tier=excluded.selected_tier,updated_at=excluded.updated_at
RETURNING selected_tier
`;

function validUserId(id) {return typeof id==="string" && id.length>0 && id.length<=200 && !id.includes("\0");}
function validTime(t) {return Number.isSafeInteger(t)&&t>=0;}
function asTier(t) {return Object.hasOwn(RANK,t)?t:null;}
export function minimumPlanForFeature(feature) {
  if(typeof feature!=="string" || !Object.hasOwn(FEATURE_LEVELS,feature))
    throw new TypeError("Unknown protected feature");
  return FEATURE_LEVELS[feature];
}
export function tierAllows(selectedTier,feature) {
  const required=minimumPlanForFeature(feature);
  if(!asTier(selectedTier))return false;
  return RANK[selectedTier]>=RANK[required];
}
export function featuresForTier(tier) {
  if(!asTier(tier))throw new TypeError("Invalid plan tier");
  return Object.freeze(Object.keys(FEATURE_LEVELS).filter(feature=>tierAllows(tier,feature)));
}
function freeSnapshot(reason="free_only",enabled=false){
  return Object.freeze({
    selectedTier:"free",effectiveTier:"free",paidTier:null,
    availableTiers:Object.freeze(["free"]),
    accessibleFeatures:featuresForTier("free"),
    planSelectionEnabled:enabled,paidCheckoutLive:false,
    reason, source:"server",creditsGranted:false
  });
}
// Default-disabled means existing Free traffic is unaffected. No client or
// Worker env var can magically create a paid entitlement: signed payment proof
// and active subscription rows must already be in D1, and be current.
export async function resolvePlanAccess(env,userId,{nowSec=Math.floor(Date.now()/1000)}={}){
  if(env?.PLAN_ENTITLEMENTS_ENABLED!=="true" || userId==null)
    return freeSnapshot("paid_plans_not_active");
  if(!validUserId(userId))throw new TypeError("Authenticated user ID required");
  if(!validTime(nowSec))throw new TypeError("Valid entitlement lookup time required");
  if(!env.DB?.prepare)throw new Error("Entitlement database unavailable");
  const row=await env.DB.prepare(SQL).bind(userId).first();
  if(!row)throw new Error("Incomplete entitlement database response");
  const storedSelection=row.selected_tier===null||row.selected_tier===undefined
    ?"free":asTier(row.selected_tier);
  if(!storedSelection)throw new Error("Unknown selected plan tier");
  if(row.paid_tier==null){
    if(row.entitlement_status!=null || row.payment_status!=null)
      throw new Error("Inconsistent entitlement record");
    return freeSnapshot("no_verified_paid_entitlement",true);
  }
  const paid=asTier(row.paid_tier);
  if(!paid || paid==="free" ||
    !["active","pending","past_due","cancelled","revoked"].includes(row.entitlement_status) ||
    !validTime(row.starts_at) || !validTime(row.ends_at) ||
    row.ends_at<=row.starts_at || row.ends_at>row.starts_at+32*86400)
    throw new Error("Invalid paid entitlement snapshot");
  // If the payment evidence is missing on an active row (e.g., broken foreign
  // keys), never fabricate a valid subscription.
  if(row.payment_status==null || !["verified_paid","refunded","chargeback","revoked"].includes(row.payment_status) ||
    !validTime(row.verified_at))
    throw new Error("Unverifiable paid entitlement source");
  const current=row.entitlement_status==="active" &&
    row.payment_status==="verified_paid" &&
    row.verified_at<=nowSec && row.starts_at<=nowSec && row.ends_at>nowSec;
  if(!current)return freeSnapshot("inactive_or_expired_payment",true);
  // A Pro subscriber may voluntarily use Basic or Free, but Basic cannot
  // choose Pro. A downgraded or refunded user's stale selection is Free.
  const selected=RANK[storedSelection]<=RANK[paid]?storedSelection:"free";
  return Object.freeze({
    selectedTier:selected,effectiveTier:selected,paidTier:paid,
    availableTiers:Object.freeze(PLAN_ORDER.filter(t=>RANK[t]<=RANK[paid])),
    accessibleFeatures:featuresForTier(selected),
    planSelectionEnabled:true,paidCheckoutLive:false,
    reason:selected==="free"?"free_mode_selected":"verified_paid_entitlement",
    source:"server",creditsGranted:false
  });
}
export async function authorizePlanFeature(env,userId,feature,options={}){
  const required=minimumPlanForFeature(feature);
  const access=await resolvePlanAccess(env,userId,options);
  return Object.freeze({
    allowed:tierAllows(access.effectiveTier,feature),
    requiredTier:required,effectiveTier:access.effectiveTier,
    paidCheckoutLive:false,creditsGranted:false
  });
}
export async function selectAccountPlan(env,userId,tier,{nowSec=Math.floor(Date.now()/1000)}={}){
  if(env?.PLAN_ENTITLEMENTS_ENABLED!=="true")
    return Object.freeze({ok:false,reason:"plan_selection_not_active"});
  if(!validUserId(userId)||!validTime(nowSec))throw new TypeError("Authenticated account and valid time required");
  if(!asTier(tier))return Object.freeze({ok:false,reason:"invalid_plan"});
  if(!env.DB?.prepare)throw new Error("Entitlement database unavailable");
  // Single guarded DB statement; the client does not supply paid tier, paid
  // source, end date, currency or credits. Never writes payment/order tables.
  const written=await env.DB.prepare(SELECTION_SQL).bind(
    userId,tier,nowSec,tier,userId,nowSec,nowSec,nowSec,tier
  ).first();
  if(!written || written.selected_tier!==tier)
    return Object.freeze({ok:false,reason:"verified_plan_required"});
  const snapshot=await resolvePlanAccess(env,userId,{nowSec});
  if(snapshot.effectiveTier!==tier)
    return Object.freeze({ok:false,reason:"paid_plan_no_longer_active"});
  return Object.freeze({ok:true,plan:snapshot});
}
