// Produces a LOCAL, non-deployable Wrangler D1 *listing* configuration.
// This never calls Cloudflare and deliberately has NO 'apply' implementation.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const migrationFiles = Object.freeze(['0012_image_jobs.sql','0016_image_chat_history.sql']);
const rootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const finance = /\b(?:billing_[a-z0-9_]*|duitku|midtrans|synthetic_test|sandbox_payment_url|payment_verified|chargeback_verified)\b/i;
const uuid = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i;

export function prepareImageOnlyMigrationList({root=rootDefault}={}) {
  const sourceConfig = JSON.parse(fs.readFileSync(path.join(root,'wrangler.jsonc'),'utf8'));
  const entries=sourceConfig.d1_databases;
  if(!Array.isArray(entries)||entries.length!==1||entries[0].binding!=='DB'||
    entries[0].database_name!=='bor-ai-chat'||!uuid.test(entries[0].database_id||'')||
    entries[0].migrations_dir!=='migrations')
    throw Error('Image migration listing must pin the existing production chat D1 and migration directory');
  if(sourceConfig.vars?.BOR_IMAGES_ENABLED!=='false')
    throw Error('Image migration listing must start with paid images disabled');
  if(sourceConfig.vars?.URL_READER_ENABLED!=='false')
    throw Error('Image migration listing must start with reviewed Reader-OFF repository baseline');
  const sources = migrationFiles.map(name=>{
    const sql=fs.readFileSync(path.join(root,'migrations',name),'utf8');
    if(finance.test(sql))throw Error('Image-only migration contains financial or synthetic billing SQL');
    if(name==='0012_image_jobs.sql'&&!/CREATE TABLE image_jobs\b/.test(sql))
      throw Error('Image-job migration is missing core image_jobs schema');
    if(name==='0016_image_chat_history.sql'&&!/ALTER TABLE image_jobs ADD COLUMN conversation_id\b/.test(sql))
      throw Error('Image-history migration is missing conversation binding');
    return {name,sql};
  });
  const target=path.join(root,'.wrangler','image-only-migrations');
  fs.mkdirSync(target,{recursive:true});
  // Fail closed on injected/accidental files, including billing migrations.
  const present=fs.readdirSync(target);
  for(const file of present){
    if(!migrationFiles.includes(file))throw Error('Unexpected file in generated image-only migrations directory');
  }
  for(const {name,sql} of sources) {
    const dest=path.join(target,name);
    if(fs.existsSync(dest)&&fs.readFileSync(dest,'utf8')!==sql)
      throw Error('Generated image migration differs from its checked-in source');
    if(!fs.existsSync(dest))fs.writeFileSync(dest,sql,{flag:'wx'});
  }
  const config={
    $schema:'node_modules/wrangler/config-schema.json',
    name:'bor-ai-image-migration-list-only',
    // Intentionally omit 'main', 'assets', bindings and production vars.
    // This generated file must never be used for a Worker deploy.
    d1_databases:[{
      binding:'DB',
      database_name:entries[0].database_name,
      database_id:entries[0].database_id,
      migrations_dir:'.wrangler/image-only-migrations',
      ...(entries[0].migrations_table?{migrations_table:entries[0].migrations_table}:{})
    }]
  };
  const configPath=path.join(root,'wrangler.image-only-migrations.generated.jsonc');
  fs.writeFileSync(configPath,JSON.stringify(config,null,2)+'\n');
  return Object.freeze({
    configFile:'wrangler.image-only-migrations.generated.jsonc',
    generatedDir:'.wrangler/image-only-migrations',
    migrations:migrationFiles,
    remoteDatabase:'bor-ai-chat',
    onlyListsMigrations:true,
    applied:false,
    noWorkerDeployment:true
  });
}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{
    const plan=prepareImageOnlyMigrationList();
    // Safe report: no SQL, secrets, database UUID, user records, or Cloudflare calls.
    process.stdout.write(JSON.stringify(plan,null,2)+'\n');
  }catch(error){
    console.error('Image-only migration listing blocked:',error.message);
    process.exitCode=1;
  }
}
