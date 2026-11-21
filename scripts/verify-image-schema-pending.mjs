// Fail-closed parser for Wrangler's human-readable *read-only* D1 migration inventory.
// Keep the production image release separate from deployment/Reader preservation.
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const EXPECTED=Object.freeze(['0012_image_jobs.sql','0016_image_chat_history.sql']);
const ANSI=/\x1b\[[0-9;]*m/g;
const TABLE_ROW=/^\s*│\s*([^│]+?)\s*│\s*$/;
export function verifyImageSchemaPending(output,{expectNone=false}={}){
  if(typeof output!=='string'||!output.trim()||output.length>32768)
    throw Error('D1 migration inventory is absent or exceeds the safe output limit');
  const clean=output.replace(ANSI,'');
  const listed=clean.split(/\r?\n/).map(line=>line.match(TABLE_ROW)?.[1]?.trim()).filter(name=>name&&name!=='Name');
  if(new Set(listed).size!==listed.length)throw Error('D1 migration inventory contains duplicate names');
  if(expectNone){
    if(listed.length || !/No migrations (?:to apply|to be applied|found)/i.test(clean))
      throw Error('Image D1 post-apply listing has not proven an empty pending set');
  }else {
    if(!/Migrations to be applied:/i.test(clean)||
       listed.length!==EXPECTED.length||
       listed.some((name,index)=>name!==EXPECTED[index]))
      throw Error('Production D1 pending set drifted; require exactly 0012 and 0016 in order');
  }
  return Object.freeze({safe:true,pending:listed,length:listed.length,productionD1:'bor-ai-chat',expectNone});
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [path,flag]=process.argv.slice(2);
    if(!path||!['--expect-pair','--expect-none'].includes(flag))
      throw Error('Pass a listing file and exactly one expected-state flag');
    const state=verifyImageSchemaPending(readFileSync(path,'utf8'),{expectNone:flag==='--expect-none'});
    console.log('Image-only production D1 inventory verified:',state.length,'pending, no billing migrations.');
  }catch(error){
    console.error('BLOCKED: image-only D1 migration verification failed:',error.message);
    process.exitCode=1;
  }
}
