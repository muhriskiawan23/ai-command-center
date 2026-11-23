import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {
  auditProductionChatJournalWriteSurface,
  JOURNAL_WRITE_SURFACE_MATRIX,
  CURRENT_CUTOVER_BLOCKERS
} from '../tools/recovery/audit-production-chat-journal-write-surface.mjs';

test('production chat write surface is exhaustively pinned, source-only and NOT live journal protected',()=>{
  const report=auditProductionChatJournalWriteSurface();
  assert.equal(report.passed,true);
  assert.equal(report.readonly,true);
  assert.equal(report.productionJournalActive,false);
  assert.equal(report.safeToActivateProduction,false);
  assert.equal(report.productionCutoverBlocked,true);
  assert.equal(report.reviewedSqlLiterals,58);
  assert.equal(report.excludedIsolatedStagingSqlLiterals,6);
  assert.equal(report.productionJournalCoveredSqlLiterals,0);
  assert.ok(report.distinctReviewedSites>=30);
  assert.equal(report.customerChatRead,false);
  assert.equal(report.cloudflareCalls,0);
  assert.equal(report.productionMutations,0);
  assert.equal(report.domains.chat,12);
  assert.equal(report.domains.chat_image,3);
  assert.equal(report.domains.image,10);
  assert.equal(report.domains.sessions,4);
  assert.ok(report.blockers.length>=9);
  assert.equal(new Set(report.blockers).size,report.blockers.length);
  assert.deepEqual(report.blockers,[...CURRENT_CUTOVER_BLOCKERS]);
});

test('future app chat INSERT/DELETE requires deliberate review before CI can pass',()=>{
  const path='src/index.js',s=readFileSync(path,'utf8');
  const withNewWriter=s+'\nconst notDeployed = "INSERT INTO messages(id) VALUES(999)";\n';
  assert.throws(()=>auditProductionChatJournalWriteSurface({
    sourceOverrides:{[path]:withNewWriter}
  }),/journal_write_coverage_inventory_drift:.*src\/index\.js\/INSERT INTO\/messages\(5->6\)/);
  const removed=s.replace('DELETE FROM conversations WHERE user_id = ?', 'SELECT id FROM conversations WHERE user_id = ?');
  assert.throws(()=>auditProductionChatJournalWriteSurface({
    sourceOverrides:{[path]:removed}
  }),/journal_write_coverage_inventory_drift:.*src\/index\.js\/DELETE FROM\/conversations\(2->1\)/);
});

test('new chat D1 writer module fails inventory gate rather than silently going unjournaled',()=>{
  const name='unreviewed-chat-bypass.js';
  assert.throws(()=>auditProductionChatJournalWriteSurface({
    srcNames:['index.js','image-jobs.js','memory.js','widget-api.js','github-oauth.js',
      'daily-limits.js','research.js','billing-staging-worker.js',name],
    sourceOverrides:{['src/'+name]:'const fake = "DELETE FROM messages WHERE id = ?";'}
  }),/journal_write_coverage_inventory_drift:.*new_unreviewed_writer:src\/unreviewed-chat-bypass\.js\/DELETE FROM\/messages/);
});

test('fail closed if any production journaling flag or Durable Object binding appears before backfill',()=>{
  const config=JSON.parse(readFileSync('wrangler.jsonc','utf8'));
  assert.throws(()=>auditProductionChatJournalWriteSurface({
    wranglerOverride:{...config,durable_objects:{bindings:[{name:'CHAT_JOURNAL',class_name:'ChatJournalDurableObject'}]}}
  }),/journal_write_unreviewed_production_activation/);
  assert.throws(()=>auditProductionChatJournalWriteSurface({
    wranglerOverride:{...config,vars:{...config.vars,CHAT_JOURNAL_ACTIVE:'true'}}
  }),/journal_write_unreviewed_production_activation/);
  const app=readFileSync('src/index.js','utf8');
  assert.throws(()=>auditProductionChatJournalWriteSurface({
    sourceOverrides:{'src/index.js':app+'\n// CHAT_JOURNAL integration without approved backfill\n'}
  }),/journal_write_unreviewed_production_activation/);
});

test('explicitly document unsupported INTEGER IDs, sessions, sources, image dependency and missing restore evidence',()=>{
  const report=auditProductionChatJournalWriteSurface();
  for(const key of [
    'no_original_integer_message_id_and_fk_stability_contract',
    'no_complete_user_session_memory_image_api_key_or_oauth_recovery_contract',
    'no_history_backfill_with_deletion_privacy_and_retention_proof',
    'no_production_sql_export_and_nonproduction_full_fidelity_restore_proof',
    'no_cross_store_crash_consistency_replay_and_read_your_writes_at_scale'
  ]) assert.ok(report.blockers.includes(key));
  const source=readFileSync('src/chat-journal-do.js','utf8');
  assert.match(source,/shape\(p,\['conversation_id','message_id','role','content'\]\)/);
  assert.doesNotMatch(source,/original_d1_message_id|original_d1_created_at|original_links_json/);
  const app=readFileSync('src/index.js','utf8');
  assert.match(app,/INSERT INTO messages \(conversation_id, user_id, role, content, created_at, idempotency_key\)/);
  assert.match(app,/INSERT INTO messages \(conversation_id, user_id, role, content, created_at, links_json\)/);
  assert.match(app,/INSERT INTO answer_feedback/);
  assert.match(readFileSync('src/image-jobs.js','utf8'),/INSERT INTO conversations/);
  assert.equal(JOURNAL_WRITE_SURFACE_MATRIX.every(x=>x.coveredByActiveJournal===false),true);
});
