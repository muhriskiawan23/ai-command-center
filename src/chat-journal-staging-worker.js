// Deliberately inert public surface. Only a future authenticated production
// Worker may call the private Durable Object via its namespace binding.
// This staging-only entrypoint never receives or exports customer chat data.
export { ChatJournalDurableObject } from './chat-journal-do.js';
export default {
  async fetch() {
    return new Response('Not found', {status:404,headers:{'Cache-Control':'no-store'}});
  }
};
