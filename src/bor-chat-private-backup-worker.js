// Private backup Worker for Cloudflare Workflows. No public routes.
// Deployment is forbidden until a dedicated private R2 bucket, narrowly-scoped
// export credential and an independent operator approval have been reviewed.
import {WorkflowEntrypoint} from 'cloudflare:workers';
import {runPrivateBackup} from './bor-chat-private-backup-core.js';

export class BorChatPrivateBackupWorkflow extends WorkflowEntrypoint {
  async run(event,step){
    return runPrivateBackup({env:this.env,event,step});
  }
}
export default {
  async fetch(){
    return new Response('Not found',{status:404,headers:{
      'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'
    }});
  }
};
