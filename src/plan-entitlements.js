// INACTIVE Stage 3 plan authorization. Paid status comes ONLY from a
// server-verified payment and a current subscription. No "mode" switch:
// Basic automatically inherits Free; Pro automatically inherits Basic + Free.
// Never trust browser tier, order, credit, query string or model name.
export const PLAN_ORDER=Object.freeze(["free","basic","pro"]);
const RANK=Object.freeze({free:0,basic:1,pro:2});
export const PLAN_FEATURE_LEVELS=Object.freeze({
  chat:"free",
  specialist_agents:"free",
  multi_agent:"free",
  signed_in_history:"free",
  basic_paid_credits:"basic",
  credit_topups:"basic",
  image_understanding:"basic",
  image_generation:"basic",
  image_editing:"basic",
  wallpaper_creation:"basic",
  video_frame_analysis:"pro",
  high_detail_image_generation:"pro",
  multi_reference_image_editing:"pro",
  advanced_video_analysis:"pro",
  pro_credit_capacity:"pro",
  pro_rollover_eligibility:"pro" // possible only with reviewed margin and credit lots
});
const SQL=`
SELECT e.paid_tier, e.status AS entitlement_status, e.starts_at, e.ends_at,
       p.verification_status AS payment_status, p.verified_at
FROM (SELECT ? AS user_id) subject
LEFT JOIN plan_entitlements e ON e.user_id=subject.user_id
LEFT JOIN verified_plan_payments p
  ON p.order_id=e.payment_order_id
 AND p.user_id=e.user_id AND p.purchased_tier=e.paid_tier
`;
function tier(t){return typeof t==="string" && Object.hasOwn(RANK,t)?t:null;}
function safeTime(t){return Number.isSafeInteger(t)&&t>=0;}
function validUserId(id){return typeof id==="string" && id.length>0 && id.length<=200 && !id.includes("\0");}
export function minimumPlanForFeature(feature){
  if(typeof feature!=="string" || !Object.hasOwn(PLAN_FEATURE_LEVELS,feature))
    throw new TypeError("Unknown protected feature");
  return PLAN_FEATURE_LEVELS[feature];
}
export function tierAllows(t,feature){
  const required=minimumPlanForFeature(feature);
  return tier(t)!==null && RANK[t]>=RANK[required];
}
export function featuresForTier(t){
  if(tier(t)===null)throw new TypeError("Invalid plan tier");
  return Object.freeze(Object.keys(PLAN_FEATURE_LEVELS).filter(feature=>tierAllows(t,feature)));
}
function snapshot(t,reason){
  return Object.freeze({
    plan:t,effectiveTier:t,paidTier:t==="free"?null:t,
    accessibleFeatures:featuresForTier(t),
    paidCheckoutLive:false,creditsGranted:false,
    reason,source:"server"
  });
}
export async function resolvePlanAccess(env,userId,{nowSec=Math.floor(Date.now()/1000)}={}){
  if(env?.PLAN_ENTITLEMENTS_ENABLED!=="true" || userId==null)
    return snapshot("free","paid_plans_not_active");
  if(!validUserId(userId))throw new TypeError("Authenticated user ID required");
  if(!safeTime(nowSec))throw new TypeError("Valid lookup time required");
  if(!env.DB?.prepare)throw new Error("Entitlement database unavailable");
  const row=await env.DB.prepare(SQL).bind(userId).first();
  if(!row)throw new Error("Incomplete entitlement database response");
  if(row.paid_tier==null){
    if(row.entitlement_status!=null || row.payment_status!=null)
      throw new Error("Inconsistent entitlement record");
    return snapshot("free","no_verified_paid_entitlement");
  }
  if(!["basic","pro"].includes(row.paid_tier)||
    !["active","pending","past_due","cancelled","revoked"].includes(row.entitlement_status)||
    !safeTime(row.starts_at)||!safeTime(row.ends_at)||
    row.ends_at<=row.starts_at||row.ends_at>row.starts_at+32*86400)
    throw new Error("Invalid paid entitlement snapshot");
  if(!["verified_paid","refunded","chargeback","revoked"].includes(row.payment_status)||
    !safeTime(row.verified_at))
    throw new Error("Unverifiable paid entitlement source");
  if(row.entitlement_status!=="active"||row.payment_status!=="verified_paid"||
    row.verified_at>nowSec||row.starts_at>nowSec||row.ends_at<=nowSec)
    return snapshot("free","inactive_or_expired_payment");
  return snapshot(row.paid_tier,"verified_paid_entitlement");
}
export async function authorizePlanFeature(env,userId,feature,options={}){
  const requiredTier=minimumPlanForFeature(feature);
  const p=await resolvePlanAccess(env,userId,options);
  return Object.freeze({
    allowed:tierAllows(p.plan,feature),
    requiredTier,effectiveTier:p.plan,
    paidCheckoutLive:false,creditsGranted:false
  });
}
