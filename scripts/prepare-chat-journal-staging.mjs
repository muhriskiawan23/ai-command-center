// Generate a non-deploying, isolated journal *staging* configuration.
// NEVER add the namespace to production Worker until every writer, replay
// path, access control, privacy erasure and disaster drill is independently
// signed off. This script performs no Cloudflare calls, writes or API charges.
import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export function makeJournalStagingConfig(){
  const config={
    $schema:'node_modules/wrangler/config-schema.json',
    name:'bor-ai-chat-journal-staging',
    main:'src/chat-journal-staging-worker.js',
    compatibility_date:'2026-10-28',
    durable_objects:{bindings:[{name:'CHAT_JOURNAL',class_name:'ChatJournalDurableObject'}]},
    migrations:[{tag:'journal-staging-v1',new_sqlite_classes:['ChatJournalDurableObject']}],
    vars:{CHAT_JOURNAL_ACTIVE:'false'}
  };
  const prod=JSON.parse(readFileSync(new URL('../wrangler.jsonc',import.meta.url),'utf8'));
  if(prod.name===config.name||config.name==='ai-command-center'||config.main===prod.main)
    throw Error('journal_staging_must_be_isolated');
  if('d1_databases' in config || 'r2_buckets' in config || 'queues' in config ||
    'ai' in config || 'assets' in config || 'routes' in config || 'triggers' in config)
    throw Error('journal_staging_resources_not_allowed');
  return config;
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try {
    const dest=process.argv[2]||'wrangler.chat-journal-staging.generated.jsonc';
    if(!/^wrangler\.chat-journal-staging(?:\.[A-Za-z0-9_-]+)?\.generated\.jsonc$/.test(dest))
      throw Error('invalid_journal_staging_config_path');
    const config=makeJournalStagingConfig();
    writeFileSync(dest,JSON.stringify(config,null,2)+'\n');
    process.stdout.write('Wrote inert journal staging config without production DB or image bindings.\n');
  }catch(error){console.error('BLOCKED:',error.message);process.exitCode=1;}
}
