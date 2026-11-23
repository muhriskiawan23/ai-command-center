// CLOSED staging-only Worker. No customer content and no production D1 binding.
// No workers.dev, routes, assets, cron, HTTP test endpoint or forwarding.
import {WorkflowEntrypoint} from 'cloudflare:workers';
import {executeClosedSyntheticJournalDrill,isApprovedClosedJournalDrill} from './chat-journal-staging-synthetic-drill.js';
import {approvedAtomicSyntheticDrill,executeClosedAtomicSyntheticJournalDrill}
  from './chat-journal-staging-atomic-drill.js';
export {ChatJournalDurableObject} from './chat-journal-do.js';

export class ChatJournalSyntheticStagingWorkflow extends WorkflowEntrypoint {
  async run(event,step){
    // Never allow an operator to supply user IDs or arbitrary payloads.
    // Both supported versions use only hardcoded synthetic markers and a
    // fresh per-instance isolated Durable Object; neither touches primary D1.
    const options={payload:event?.payload,instanceId:event?.instanceId};
    if(approvedAtomicSyntheticDrill(options.payload,options.instanceId)){
      return step.do('closed synthetic atomic-turn SQLite Durable Object proof',
        {retries:{limit:0,delay:'1 second'},timeout:'2 minutes'},
        async()=>executeClosedAtomicSyntheticJournalDrill(this.env,options));
    }
    if(isApprovedClosedJournalDrill(options.payload,options.instanceId)){
      return step.do('closed legacy synthetic Durable Object journal proof',
        {retries:{limit:0,delay:'1 second'},timeout:'2 minutes'},
        async()=>executeClosedSyntheticJournalDrill(this.env,options));
    }
    throw Error('staging_workflow_payload_not_approved');
  }
}
export default {
  async fetch(){
    return new Response('Not found',{status:404,headers:{
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
    }});
  }
};
