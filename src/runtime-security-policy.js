// Cost-bearing routes require both quota storage and rate limiting in production.
// Local synthetic harnesses intentionally remain usable without remote bindings.
const COST_ROUTES=new Set(["/api/chat","/api/public/chat","/api/documents/pdf","/api/integrations/telegram/webhook"]);
export function productionSecurityRequired(env,url){
 return env.BOR_RUNTIME_SECURITY_REQUIRED==="true"||["getborai.com","app.getborai.com","ai-command-center.muhriskiawan23.workers.dev"].includes(url.hostname);
}
export function costRouteGuard(env,url,method){
 if(method!=="POST"||!COST_ROUTES.has(url.pathname)||!productionSecurityRequired(env,url))return null;
 if(!env.DB?.prepare||typeof env.CHAT_LIMITER?.limit!=="function")
  return {status:503,code:"quota_security_unavailable"};
 return null;
}
export function serverPdfConversionAllowed(env,url){
 // Browser extraction/OCR is the reviewed no-provider path. Server conversion
 // is deliberately unavailable in production and whenever text wrappers are
 // active, until an independently costed PDF conversion policy is approved.
 return !productionSecurityRequired(env,url)&&env.BOR_TEXT_AI_DAILY_USD_LIMIT===undefined&&env.BOR_TEXT_BACKUP_ENABLED!=="true"&&typeof env.AI?.toMarkdown==="function";
}
