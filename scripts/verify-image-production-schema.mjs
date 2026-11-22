// Read-only post-apply image schema inspection of a pinned production D1.
// It does not create tables, deploy a Worker, enable images or inspect user rows.
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';

export const IMAGE_REQUIRED_OBJECTS=Object.freeze({
  image_jobs:'table',
  image_wallets:'table',
  image_credit_ledger:'table',
  image_pilot_meter:'table',
  image_reserve:'trigger',
  image_reserve_debit:'trigger',
  image_refund:'trigger',
  image_grant:'trigger',
  image_pilot_admit:'trigger',
  image_pilot_hold:'trigger',
  image_jobs_by_conversation:'index'
});
export function verifyImageProductionSchema(objects,columns){
  if(!Array.isArray(objects)||!Array.isArray(columns))throw Error('image_schema_metadata_unverifiable');
  const found=new Map();
  for(const object of objects){
    if(typeof object?.name!=='string'||typeof object?.type!=='string'||
       found.has(object.name))throw Error('image_schema_metadata_invalid');
    found.set(object.name,object.type);
  }
  for(const [name,type] of Object.entries(IMAGE_REQUIRED_OBJECTS))
    if(found.get(name)!==type)throw Error('image_schema_object_missing_or_wrong_type');
  const names=new Set(columns.map(row=>row?.name));
  for(const key of ['id','user_id','request_id','status','source_key','output_key','credits','tariff_version','conversation_id'])
    if(!names.has(key))throw Error('image_job_column_missing');
  return Object.freeze({verified:true,objectsChecked:Object.keys(IMAGE_REQUIRED_OBJECTS).length,
    chatAssociationVerified:true,readOnly:true});
}
function runReadOnlySql(config,query){
  let stdout;
  try{
    stdout=execFileSync('npx',[
      '--yes','wrangler@4.165.0','d1','execute','bor-ai-chat','--remote',
      '--config',config,'--command',query,'--json'
    ],{encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024,stdio:['ignore','pipe','pipe']});
  }catch{throw Error('image_schema_remote_metadata_unavailable');}
  let parsed;
  try{parsed=JSON.parse(stdout.trim());}
  catch{throw Error('image_schema_remote_metadata_unverifiable');}
  const batches=Array.isArray(parsed)?parsed:[parsed];
  if(!batches.length||batches.some(batch=>!Array.isArray(batch.results)))
    throw Error('image_schema_remote_metadata_invalid');
  return batches.flatMap(batch=>batch.results);
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const [flag,config]=process.argv.slice(2);
    if(flag!=='--config'||config!=='wrangler.image-only-migrations.generated.jsonc')
      throw Error('Use only the generated image-only production D1 configuration');
    const names=Object.keys(IMAGE_REQUIRED_OBJECTS).map(name=>"'"+name+"'").join(',');
    const objects=runReadOnlySql(config,
      'SELECT name,type FROM sqlite_master WHERE name IN ('+names+')');
    const columns=runReadOnlySql(config,'PRAGMA table_info(image_jobs)');
    const status=verifyImageProductionSchema(objects,columns);
    console.log('Verified image-only production D1 schema metadata:',status.objectsChecked,'objects; no user rows read.');
  }catch(error){console.error('BLOCKED:',error.message);process.exitCode=1;}
}
