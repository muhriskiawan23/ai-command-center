// READ-ONLY P0 recovery CUTOVER GATE. Never connects to Cloudflare, imports
// production Worker code, logs chat bodies or touches SQLite. Exactly pin
// observed writes to the checked-in primary application source, including
// financially sensitive linked tables. No feature flag enables journaling.
// A new/unreviewed mutation SQL literal causes CI to fail CLOSED.
import {readdirSync,readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';

const ROOT=fileURLToPath(new URL('../../',import.meta.url));
const MUTATION=/(INSERT(?:\s+OR\s+(?:IGNORE|REPLACE|ABORT|FAIL|ROLLBACK))?\s+INTO|REPLACE\s+INTO|UPDATE|DELETE\s+FROM)\s+(users|sessions|conversations|messages|answer_feedback|user_memories|user_settings|image_jobs|image_wallets|image_credit_ledger|image_pilot_meter|public_api_keys|github_connections|github_oauth_states|daily_usage|search_provider_usage)\b/gi;
const KEY=(path,verb,table)=>path+'|'+verb.toUpperCase().replace(/\s+/g,' ')+'|'+table.toLowerCase();

// Sources listed here are exactly the live, production-linked SQL writers
// examined on 23 Nov 2026. billing-staging-worker is specifically EXCLUDED
// because it has a separate isolated Worker DB, not app.getborai.com D1.
// expected count means number of DISTINCT source SQL literals (not requests).
const MATRIX=Object.freeze([
  ['src/index.js','INSERT INTO','users',1,'identity'],
  ['src/index.js','DELETE FROM','sessions',3,'sessions'],
  ['src/index.js','INSERT INTO','sessions',1,'sessions'],
  ['src/index.js','DELETE FROM','conversations',2,'chat'],
  ['src/index.js','UPDATE','conversations',2,'chat'],
  ['src/index.js','DELETE FROM','messages',1,'chat'],
  ['src/index.js','INSERT INTO','conversations',1,'chat'],
  ['src/index.js','INSERT INTO','messages',5,'chat'],
  ['src/index.js','INSERT INTO','answer_feedback',1,'chat'],
  ['src/image-jobs.js','UPDATE','image_pilot_meter',3,'billing_image'],
  ['src/image-jobs.js','UPDATE','image_jobs',9,'image'],
  ['src/image-jobs.js','INSERT INTO','conversations',1,'chat_image'],
  ['src/image-jobs.js','DELETE FROM','conversations',1,'chat_image'],
  ['src/image-jobs.js','INSERT INTO','image_jobs',1,'image'],
  ['src/image-jobs.js','UPDATE','conversations',1,'chat_image'],
  ['src/memory.js','INSERT INTO','user_settings',1,'memory'],
  ['src/memory.js','INSERT INTO','user_memories',1,'memory'],
  ['src/memory.js','DELETE FROM','user_memories',2,'memory'],
  ['src/widget-api.js','INSERT INTO','public_api_keys',1,'developer_keys'],
  ['src/widget-api.js','UPDATE','public_api_keys',5,'developer_keys'],
  // API-key usage consumes/refunds primary daily quota independently of the
  // regular chat route. These counters matter for a safe recovery cutover.
  ['src/widget-api.js','INSERT INTO','daily_usage',1,'usage_budget'],
  ['src/widget-api.js','UPDATE','daily_usage',3,'usage_budget'],
  ['src/github-oauth.js','UPDATE','github_connections',1,'github_oauth'],
  ['src/github-oauth.js','DELETE FROM','github_oauth_states',2,'github_oauth'],
  ['src/github-oauth.js','INSERT INTO','github_oauth_states',1,'github_oauth'],
  ['src/github-oauth.js','INSERT INTO','github_connections',1,'github_oauth'],
  ['src/github-oauth.js','DELETE FROM','github_connections',1,'github_oauth'],
  ['src/daily-limits.js','INSERT INTO','daily_usage',1,'usage_budget'],
  ['src/daily-limits.js','UPDATE','daily_usage',1,'usage_budget'],
  ['src/daily-limits.js','DELETE FROM','daily_usage',1,'usage_budget'],
  ['src/research.js','INSERT INTO','search_provider_usage',1,'usage_budget'],
  ['src/research.js','UPDATE','search_provider_usage',1,'usage_budget'],
  // Isolated billing staging has its own D1 and is NOT connected to BOR AI
  // production's DB binding. Explicitly listed to avoid accidental counts.
  ['src/billing-staging-worker.js','INSERT INTO','users',1,'isolated_billing_staging'],
  ['src/billing-staging-worker.js','INSERT INTO','sessions',1,'isolated_billing_staging'],
  // New closed recovery Worker binds only a disposable run-ID D1. It is NOT a
  // production chat writer. Pin all SQL sites rather than skipping source files.
  ['src/chat-journal-staging-d1-recovery-drill.js','INSERT INTO','users',1,'isolated_d1_recovery_staging'],
  ['src/chat-journal-staging-d1-recovery-drill.js','INSERT INTO','conversations',1,'isolated_d1_recovery_staging'],
  ['src/chat-journal-staging-d1-recovery-drill.js','INSERT INTO','messages',2,'isolated_d1_recovery_staging']
].map(([file,verb,table,expected,domain])=>Object.freeze({
  file,verb,table,expected,domain,
  production:!['isolated_billing_staging','isolated_d1_recovery_staging'].includes(domain),
  coveredByActiveJournal:false
})));

export const JOURNAL_WRITE_SURFACE_MATRIX=MATRIX;
export const CURRENT_CUTOVER_BLOCKERS=Object.freeze([
  'no_live_production_journal_binding_or_verified_append_receipt',
  'no_journal_first_coverage_for_conversation_create_turn_replace_metadata_delete_and_feedback',
  'no_journal_first_coverage_for_image_associated_conversation_mutations',
  'no_original_integer_message_id_and_fk_stability_contract',
  'no_complete_user_session_memory_image_api_key_or_oauth_recovery_contract',
  'no_history_backfill_with_deletion_privacy_and_retention_proof',
  'no_production_sql_export_and_nonproduction_full_fidelity_restore_proof',
  'no_cross_store_crash_consistency_replay_and_read_your_writes_at_scale',
  'no_approved_recurring_cost_privacy_data_residency_or_release_window'
]);

export function auditProductionChatJournalWriteSurface({
  sourceOverrides={},srcNames,wranglerOverride
}={}){
  const names=srcNames||readdirSync(join(ROOT,'src')).filter(f=>f.endsWith('.js')).sort();
  if(!Array.isArray(names)||names.some(x=>typeof x!=='string'||!/^[A-Za-z0-9-]+\.js$/.test(x)))
    throw Error('journal_write_inventory_invalid_names');
  const sourceOf=(f)=>Object.hasOwn(sourceOverrides,f)?sourceOverrides[f]:
    readFileSync(join(ROOT,f),'utf8');
  const expected=new Map();
  for(const entry of MATRIX){
    const k=KEY(entry.file,entry.verb,entry.table);
    if(expected.has(k))throw Error('journal_write_duplicate_baseline');
    expected.set(k,entry);
  }
  const observed=new Map();
  for(const name of names){
    const path='src/'+name;
    const source=sourceOf(path);
    if(typeof source!=='string')throw Error('journal_write_source_unreadable');
    for(const match of source.matchAll(MUTATION)){
      const k=KEY(path,match[1],match[2]);
      observed.set(k,(observed.get(k)||0)+1);
    }
  }
  const mismatches=[];
  for(const [k,entry] of expected){
    const count=observed.get(k)||0;
    if(count!==entry.expected)mismatches.push({kind:'changed_reviewed_writer',file:entry.file,
      action:entry.verb,table:entry.table,expected:entry.expected,observed:count});
  }
  for(const [k,count] of observed){
    if(!expected.has(k)){
      const [file,action,table]=k.split('|');
      mismatches.push({kind:'new_unreviewed_writer',file,action,table,observed:count});
    }
  }
  if(mismatches.length) {
    // No SQL source, secret, customer text, IP or bind argument in error.
    const detail=mismatches.map(x=>x.kind+':'+x.file+'/'+x.action+'/'+x.table+
      '('+(x.expected??0)+'->'+x.observed+')').join('; ');
    throw Error('journal_write_coverage_inventory_drift: '+detail);
  }
  // Critical safety boundary: this is NOT a production journal integration.
  // Any new live binding/activation requires a separate reviewed cutover PR,
  // complete replay/backfill and owner permission, not this source audit.
  const worker=sourceOf('src/index.js');
  const config=wranglerOverride===undefined?
    JSON.parse(readFileSync(join(ROOT,'wrangler.jsonc'),'utf8')):wranglerOverride;
  if(worker.includes('CHAT_JOURNAL')||worker.includes('chat-journal-do')||
     config?.durable_objects?.bindings?.some(x=>/JOURNAL/i.test(x.name+' '+x.class_name))||
     config?.vars?.CHAT_JOURNAL_ACTIVE==='true')
    throw Error('journal_write_unreviewed_production_activation');
  const production=MATRIX.filter(x=>x.production);
  const isolated=MATRIX.filter(x=>!x.production);
  const total=(v)=>v.reduce((n,x)=>n+x.expected,0);
  const byDomain=Object.fromEntries([...new Set(production.map(x=>x.domain))].sort().map(domain=>
    [domain,total(production.filter(x=>x.domain===domain))]));
  return Object.freeze({
    passed:true,readonly:true,productionJournalActive:false,
    safeToActivateProduction:false,productionCutoverBlocked:true,
    reviewedSqlLiterals:total(production),
    excludedIsolatedStagingSqlLiterals:total(isolated),
    distinctReviewedSites:production.length,
    productionJournalCoveredSqlLiterals:0,
    domains:byDomain,
    blockers:[...CURRENT_CUTOVER_BLOCKERS],
    customerChatRead:false,cloudflareCalls:0,productionMutations:0
  });
}

if(process.argv[1]&&fileURLToPath(import.meta.url)===process.argv[1]){
  const result=auditProductionChatJournalWriteSurface();
  process.stdout.write(JSON.stringify(result)+'\n');
}
