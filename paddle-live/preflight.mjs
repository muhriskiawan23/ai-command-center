// Read-only live onboarding preflight. No mutation, transactions, or secrets logged.
import {readFile} from "node:fs/promises";
const catalog=JSON.parse(await readFile(new URL("./catalog.json",import.meta.url),"utf8"));
if(catalog.environment!=="live"||catalog.checkoutEnabled!==false)throw new Error("Unsafe catalog configuration");
const key=process.env.PADDLE_LIVE_API_KEY;
if(!key){console.log(JSON.stringify({status:"credentials_required",productionCheckoutEnabled:false,catalog:catalog.products.map(x=>({name:x.product.name,amount:x.price.unit_price.amount,currency:x.price.unit_price.currency_code}))},null,2));process.exit(2);}
if(!key.startsWith("pdl_live_")){console.error("Expected a live API key in the environment.");process.exit(2);}
try{
const res=await fetch("https://api.paddle.com/verifications?verification_type=onboarding",{headers:{Authorization:"Bearer "+key,Accept:"application/json"},redirect:"error",signal:AbortSignal.timeout(10000)});
if(!res.ok){console.error("Paddle verification lookup failed: HTTP "+res.status);process.exit(2);}
const body=await res.json();const entries=Array.isArray(body.data)?body.data.filter(v=>v.verification_type==="onboarding"):[];
const status=entries.length===1?entries[0].status:"unknown";
console.log(JSON.stringify({status,accountVerificationComplete:status==="completed",productionCheckoutEnabled:false,checkoutReadiness:"requires approved domain, verified catalog, webhook and entitlement release gates"},null,2));
if(status!=="completed")process.exitCode=2;
}catch{console.error("Live verification lookup unavailable.");process.exitCode=2;}
