// Generate an opt-in deployment config; keys remain Worker secrets, never in JSON.
// Does not deploy, migrate, create resources, or alter the regular config.
import fs from 'node:fs';
const [output='wrangler.images.generated.jsonc']=process.argv.slice(2);
const config=JSON.parse(fs.readFileSync('wrangler.jsonc','utf8'));
const positive=value=>/^[1-9][0-9]{0,6}$/.test(value||'');
if(!positive(process.env.IMAGE_CREDITS_GENERATE)||!positive(process.env.IMAGE_CREDITS_EDIT)||!process.env.IMAGE_TARIFF_VERSION) throw Error('Set reviewed IMAGE_CREDITS_GENERATE, IMAGE_CREDITS_EDIT and IMAGE_TARIFF_VERSION before activation.');
const totalAttempts=Number(process.env.IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT);
if(!Number.isSafeInteger(totalAttempts)||totalAttempts<1||totalAttempts>10) throw Error('Set IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT to a reviewed lifetime limit of 1–10 before image activation.');
config.r2_buckets=[...(config.r2_buckets||[]),{binding:'IMAGE_FILES',bucket_name:'bor-ai-images'}];
config.queues={producers:[{binding:'IMAGE_QUEUE',queue:'bor-ai-image-jobs'}],consumers:[{queue:'bor-ai-image-jobs',max_batch_size:1,max_batch_timeout:5,max_retries:3,max_concurrency:1}]};
config.triggers={crons:['*/10 * * * *']};
Object.assign(config.vars,{BOR_IMAGES_ENABLED:'true',OPENAI_IMAGE_MODEL:'gpt-image-2',IMAGE_PILOT_QUALITY:'low',IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT:String(totalAttempts),IMAGE_CREDITS_GENERATE:process.env.IMAGE_CREDITS_GENERATE,IMAGE_CREDITS_EDIT:process.env.IMAGE_CREDITS_EDIT,IMAGE_TARIFF_VERSION:process.env.IMAGE_TARIFF_VERSION,IMAGE_DAILY_LIMIT_USER:'1',IMAGE_DAILY_LIMIT_GLOBAL:'2'});
fs.writeFileSync(output,JSON.stringify(config,null,2)+'\n');
console.log('Wrote image-enabled deployment config:',output);
