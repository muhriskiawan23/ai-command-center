// Separate, closed Worker; not the existing journal staging Worker.
import {WorkflowEntrypoint} from 'cloudflare:workers';
import {approved,drill} from './chat-journal-staging-d1-recovery-drill.js';
export {ChatJournalDurableObject} from './chat-journal-do.js';
export class ClosedJournalD1RecoveryWorkflow extends WorkflowEntrypoint {
  async run(event,step){
    const runId=this.env?.RECOVERY_RUN_ID;
    if(!approved(event?.payload,runId)||event?.instanceId!=='bor-recovery-'+runId)
      throw Error('staging_recovery_workflow_denied');
    return step.do('closed synthetic DO to D1 rollback and replay',{retries:{limit:0,delay:'1 second'},
      timeout:'3 minutes'},async()=>drill(this.env,{payload:event.payload,runId}));
  }
}
export default {async fetch(){return new Response('Not found',{status:404,
  headers:{'Cache-Control':'no-store'}});}};
