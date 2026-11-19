#!/usr/bin/env node
// Fails closed unless an operator provides a NEW, independent staging D1 UUID.
import fs from 'node:fs';
const src=JSON.parse(fs.readFileSync('wrangler.billing-staging.jsonc','utf8'));
const stageId=process.env.BILLING_STAGING_D1_ID||'';
const stageOrigin=process.env.BILLING_STAGING_PUBLIC_ORIGIN||'';
const enabling=process.env.BILLING_STAGING_ACTIVATION_ACK==='SANDBOX_ONLY_NO_REAL_MONEY';
const uuid=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
if(!uuid.test(stageId))throw Error('A new dedicated staging D1 UUID is required.');
const prod=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8')).d1_databases;
const proof=JSON.parse(fs.readFileSync('wrangler.duitku-sandbox.jsonc','utf8')).d1_databases;
if([...prod,...proof].some(x=>x.database_id===stageId))throw Error('Refusing to reuse production or fixed-proof D1.');
const u=new URL(stageOrigin);
if(u.protocol!=='https:'||u.username||u.password||u.port||u.pathname!=='/'||
   u.search||u.hash||u.hostname==='localhost'||!/^bor-ai-billing-staging\.[a-z0-9-]+\.workers\.dev$/i.test(u.hostname))
  throw Error('Expected exact dedicated bor-ai-billing-staging.<account>.workers.dev origin.');
src.d1_databases[0].database_id=stageId;
src.vars.STAGING_PUBLIC_ORIGIN=u.origin;
src.vars.BILLING_STAGING_ENABLED=enabling?'true':'false';
src.vars.BILLING_STAGING_ALLOW_TEST_INVOICES=enabling?'true':'false';
const out='wrangler.billing-staging.generated.jsonc';
fs.writeFileSync(out,JSON.stringify(src,null,2)+'\n',{mode:0o600});
console.log('Created local staging-only Wrangler config:',out);
console.log('Sandbox invoice creation enabled:',enabling);
console.log('D1 binding: BILLING_DB -> independent bor-ai-billing-staging');
console.log('No credentials stored in generated config; use Wrangler secrets.');
