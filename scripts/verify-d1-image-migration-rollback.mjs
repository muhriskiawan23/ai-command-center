// Fail-closed, GET-only production D1 Time Travel evidence before an explicitly
// approved migration dispatch. No D1 SQL, restores, or credential logging.
import { readFileSync, appendFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function checkD1RollbackReadiness({
  env=process.env, fetcher=fetch, now=()=>Date.now(),
  config=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'))
}={}){
  const account=env.CLOUDFLARE_ACCOUNT_ID,token=env.CLOUDFLARE_API_TOKEN;
  if(!/^[0-9a-f]{32}$/i.test(account||'')||!token)throw Error('D1 rollback credentials unavailable');
  const bindings=config?.d1_databases?.filter(b=>b.binding==='DB');
  const d1=bindings?.length===1?bindings[0]:null;
  if(d1?.database_name!=='bor-ai-chat'||!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(d1?.database_id||''))
    throw Error('Pinned production D1 identity is ambiguous');
  const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/d1/database/'+d1.database_id;
  const get=async(path)=>{
    const res=await fetcher(base+path,{
      method:'GET',headers:{Authorization:'Bearer '+token,Accept:'application/json'},
      redirect:'error',signal:AbortSignal.timeout(25000)
    });
    if(!res.ok)throw Error('Cannot prove production D1 rollback readiness (HTTP '+res.status+')');
    const payload=await res.json();
    if(payload?.success!==true||!payload.result)throw Error('D1 rollback verification response invalid');
    return payload.result;
  };
  const metadata=await get('');
  if(metadata.uuid!==d1.database_id||metadata.name!==d1.database_name)
    throw Error('Production D1 metadata does not match the pinned database');
  // Capture timestamp *before* the bookmark request; a point-in-time restore
  // to this UTC timestamp is documented by Cloudflare if the bookmark expires.
  const capturedAt=new Date(now()).toISOString();
  const result=await get('/time_travel/bookmark');
  const bookmark=result.bookmark;
  if(typeof bookmark!=='string'||!/^[0-9a-f]{8}(?:-[0-9a-f]{8}){2}-[0-9a-f]{16,64}$/i.test(bookmark))
    throw Error('Current D1 Time Travel bookmark cannot be verified');
  return {
    database:'bor-ai-chat',
    rollbackAvailable:true,
    beforeMigrationUTC:capturedAt,
    bookmarkFingerprint:createHash('sha256').update(bookmark).digest('hex').slice(0,16),
    warning:'Time Travel restore is destructive and limited by the Cloudflare plan retention window; snapshot must be reviewed before applying SQL.'
  };
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  checkD1RollbackReadiness().then(result=>{
    const text='BOR AI D1 pre-migration rollback proof: '+result.beforeMigrationUTC+
      ' UTC, current bookmark fingerprint '+result.bookmarkFingerprint+
      '. No SQL executed. Restoration is destructive; capture source proof before any migration.\n';
    process.stdout.write(text);
    if(process.env.GITHUB_STEP_SUMMARY)
      appendFileSync(process.env.GITHUB_STEP_SUMMARY,
        '### Production D1 migration rollback preflight\n'+
        '- Database: `bor-ai-chat` (pinned metadata verified)\n'+
        '- Bookmark validated (fingerprint only): `'+result.bookmarkFingerprint+'`\n'+
        '- UTC timestamp before migration: `'+result.beforeMigrationUTC+'`\n'+
        '- **IMPORTANT:** Time Travel is destructive, only valid within plan retention, and can lose newer chat data. No migration was executed by this preflight.\n');
  }).catch(error=>{
    console.error('BLOCKED: D1 Time Travel rollback evidence unavailable:',error.message);
    process.exitCode=1;
  });
}
