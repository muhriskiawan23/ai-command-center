// CLOSED staging-only Worker. No customer content and no production D1 binding.
// No workers.dev, routes, assets, cron, HTTP test endpoint or forwarding.
import {WorkflowEntrypoint} from 'cloudflare:workers';
import {executeClosedSyntheticJournalDrill} from './chat-journal-staging-synthetic-drill.js';
export {ChatJournalDurableObject} from './chat-journal-do.js';

export class ChatJournalSyntheticStagingWorkflow extends WorkflowEntrypoint {
  async run(event,step){
    // Even an operator-triggered instance must be strictly synthetic.
    return step.do('single closed synthetic Durable Object journal drill',
      {retries:{limit:0,delay:'1 second'},timeout:'2 minutes'},
      async()=>executeClosedSyntheticJournalDrill(this.env,{
        payload:event?.payload,instanceId:event?.instanceId
      }));
  }
}
export default {
  async fetch(){
    return new Response('Not found',{status:404,headers:{
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
    }});
  }
};
