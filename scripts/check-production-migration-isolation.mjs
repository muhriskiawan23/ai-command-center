#!/usr/bin/env node
// Protect bor-ai-chat from any synthetic or payment-billing SQL accidentally
// included in its Wrangler migrations directory. Local filesystem only.
// Production billing must use a reviewed, separate D1 and migration workflow.
import {readdirSync,readFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';

const sensitiveFilename=/(?:billing|duitku|payment|wallet|subscription|credit[-_]?ledger)/i;
const sensitiveSql=/\b(?:billing_[a-z0-9_]*|duitku|synthetic_test|sandbox_payment_url|payment_verified|chargeback_verified)\b/i;
export function inspectProductionMigrations(directory){
  if(typeof directory!=='string'||!directory.trim())
    throw new Error('production_migration_directory_required');
  const files=readdirSync(directory,{withFileTypes:true})
    .filter(item=>item.isFile()&&item.name.endsWith('.sql'))
    .map(item=>item.name).sort();
  if(files.length===0)throw new Error('production_migration_directory_empty');
  const flagged=[];
  for(const name of files){
    // Do not leak the contents of SQL or any external database details.
    const sql=readFileSync(join(directory,name),'utf8');
    if(sensitiveFilename.test(name)||sensitiveSql.test(sql))
      flagged.push(name);
  }
  return Object.freeze({safe:flagged.length===0,checkedFiles:files.length,
    blockedFiles:flagged.length,productionD1:'bor-ai-chat'});
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  try{
    const report=inspectProductionMigrations(process.argv[2]);
    if(!report.safe){
      console.error('BLOCKED: synthetic/payment billing SQL exists in production migration directory.');
      process.exitCode=1;
    }else{
      console.log('Production chat migration isolation preflight passed; no remote DB touched.');
    }
  }catch{
    console.error('BLOCKED: production migration preflight unavailable.');
    process.exitCode=1;
  }
}
