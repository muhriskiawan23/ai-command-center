import test from 'node:test';
import assert from 'node:assert/strict';
import { buildPreservedTavilyReaderConfig } from '../scripts/reader-preserve-guard.mjs';
const baseline = () => ({
  name: 'ai-command-center',
  vars: {
    URL_READER_ENABLED: 'false',
    URL_READER_PROVIDER: 'tavily',
    TAVILY_EXTRACT_DAILY_URL_LIMIT: '0',
    SEARCH_PROVIDER: 'tavily',
    BOR_IMAGES_ENABLED: 'false',
    BOR_GITHUB_CHAT_TOOLS_ENABLED: 'true'
  },
  d1_databases: [{ binding: 'DB', database_name: 'bor-ai-chat', database_id: 'synthetic-id' }]
});
const active = () => [
  { name: 'URL_READER_ENABLED', type: 'plain_text', text: 'true' },
  { name: 'URL_READER_PROVIDER', type: 'plain_text', text: 'tavily' },
  { name: 'TAVILY_EXTRACT_DAILY_URL_LIMIT', type: 'plain_text', text: '8' },
  { name: 'TAVILY_API_KEY', type: 'secret_text' }
];
function check(config, bindings) { return buildPreservedTavilyReaderConfig(config,bindings); }
test('copies only an already-active Tavily Reader with an at-most-eight-url budget', () => {
  const config=baseline(), bindings=active();
  const result=check(config,bindings);
  assert.equal(result.urlBudget,8);
  assert.equal(result.config.vars.URL_READER_ENABLED,'true');
  assert.equal(result.config.vars.URL_READER_PROVIDER,'tavily');
  assert.equal(result.config.vars.TAVILY_EXTRACT_DAILY_URL_LIMIT,'8');
  assert.deepEqual(result.config.d1_databases,config.d1_databases);
  assert.equal(config.vars.URL_READER_ENABLED,'false');
  assert.equal(config.vars.TAVILY_EXTRACT_DAILY_URL_LIMIT,'0');
  assert.equal(result.config.vars.BOR_IMAGES_ENABLED,'false');
  assert.doesNotMatch(JSON.stringify(result),/private-secret|api-key-value/);
});
test('rejects missing, malformed, non-Tavily, over-budget, secretless, or newly enabled URL readers',()=>{
  const cases=[
    b=>b.find(x=>x.name==='URL_READER_ENABLED').text='false',
    b=>b.find(x=>x.name==='URL_READER_ENABLED').type='secret_text',
    b=>b.find(x=>x.name==='URL_READER_PROVIDER').text='direct',
    b=>b.find(x=>x.name==='TAVILY_EXTRACT_DAILY_URL_LIMIT').text='0',
    b=>b.find(x=>x.name==='TAVILY_EXTRACT_DAILY_URL_LIMIT').text='9',
    b=>b.find(x=>x.name==='TAVILY_EXTRACT_DAILY_URL_LIMIT').text='008',
    b=>b.find(x=>x.name==='TAVILY_EXTRACT_DAILY_URL_LIMIT').text='10000',
    b=>b.find(x=>x.name==='TAVILY_API_KEY').type='plain_text',
    b=>b.push({name:'TAVILY_API_KEY',type:'secret_text'}),
    b=>b.splice(b.findIndex(x=>x.name==='TAVILY_API_KEY'),1)
  ];
  for(const change of cases){const b=active();change(b);assert.throws(()=>check(baseline(),b));}
  for(const change of [
    c=>c.name='unreviewed-worker',
    c=>c.vars.URL_READER_ENABLED='true',
    c=>c.vars.URL_READER_PROVIDER='direct',
    c=>c.vars.TAVILY_EXTRACT_DAILY_URL_LIMIT='8',
    c=>c.vars.BOR_IMAGES_ENABLED='true'
  ]){const c=baseline();change(c);assert.throws(()=>check(c,active()));}
});
test('preserving an eligible 1-url reader never expands its existing daily quota',()=>{
  const b=active();b.find(x=>x.name==='TAVILY_EXTRACT_DAILY_URL_LIMIT').text='1';
  const result=check(baseline(),b);
  assert.equal(result.urlBudget,1);
  assert.equal(result.config.vars.TAVILY_EXTRACT_DAILY_URL_LIMIT,'1');
});
