import { test, expect, loginAs } from './fixtures.js';
import { processImageJob } from '../../src/image-jobs.js';

// Real Cloudflare Worker routes + real in-memory D1 + synthetic image provider.
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGMUaTrxnwEJMDGgAcICAJqcAmUgQSjSAAAAAElFTkSuQmCC','base64');
test('owner generates from chat, reloads the same conversation and edits the prior image without menu',async({page,context,app})=>{
 const files=new Map();
 Object.assign(app.env,{
   BOR_IMAGES_ENABLED:'true',BOR_IMAGE_CHAT_HISTORY_ENABLED:'true',
   OPENAI_API_KEY:'synthetic-no-network',IMAGE_CREDITS_GENERATE:'10',
   IMAGE_CREDITS_EDIT:'12',IMAGE_TARIFF_VERSION:'synthetic-v1',
   OPENAI_IMAGE_MODEL:'gpt-image-2',IMAGE_PILOT_QUALITY:'low',
   IMAGE_PROVIDER_TOTAL_ATTEMPT_LIMIT:'10',
   IMAGE_FILES:{
     put:async(key,bytes)=>files.set(key,Buffer.from(bytes)),
     get:async key=>{const bytes=files.get(key);return bytes?{body:bytes,arrayBuffer:async()=>bytes}:null;},
     delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])files.delete(key);}
   },
   IMAGE_FETCHER:async()=>Response.json({data:[{b64_json:png.toString('base64')}]}),
   IMAGE_QUEUE:{send:async ({id})=>{setTimeout(()=>processImageJob(app.env,id),20);}}
 });
 await loginAs(context,app,{id:'image-chat-reload',email:'image-chat-reload@example.test'});
 app.db.sqlite.prepare('INSERT INTO image_wallets VALUES(?,?,?)').run('image-chat-reload',100,1);
 await page.goto(app.url);
 await page.locator('#prompt').fill('Buat poster promo top up game');
 await page.locator('#send').click();
 await expect(page.locator('#imageDialog')).toBeVisible();
 await expect(page.locator('#imageQuote')).toContainText('10 kredit');
 await page.locator('#imageConfirm').click();
 await expect.poll(()=>page.locator('#messages .image-response .image-result img').first().evaluate(img=>img.naturalWidth),{timeout:15000}).toBe(4);
 const chatId=app.db.sqlite.prepare('SELECT conversation_id FROM image_jobs LIMIT 1').get().conversation_id;
 expect(chatId).toMatch(/^[a-f0-9-]{36}$/i);
 expect(app.db.sqlite.prepare('SELECT COUNT(*) AS n FROM conversations').get().n).toBe(1);
 await page.reload();
 await expect.poll(()=>page.locator('#messages .image-response .image-result img').first().evaluate(img=>img.naturalWidth),{timeout:15000}).toBe(4);
 await expect(page.locator('#messages .message.user .message-text')).toContainText('Buat poster promo top up game');
 await page.locator('#prompt').fill('Buat versi lain yang lebih cerah');
 await page.locator('#send').click();
 await expect(page.locator('#imageDialog')).toBeVisible();
 await expect(page.locator('#imageQuote')).toContainText('12 kredit');
 await page.locator('#imageConfirm').click();
 await expect(page.locator('#messages .image-response .image-result img')).toHaveCount(2,{timeout:15000});
 await expect.poll(()=>page.locator('#messages .image-response .image-result img').last().evaluate(img=>img.naturalWidth),{timeout:15000}).toBe(4);
 await page.reload();
 await expect(page.locator('#messages .image-response .image-result')).toHaveCount(2,{timeout:15000});
 await expect(page.locator('#messages .message.user .message-text')).toHaveCount(2);
 const all=app.db.sqlite.prepare('SELECT conversation_id,mode FROM image_jobs ORDER BY created_at,id').all();
 expect(all).toHaveLength(2);
 expect(all.every(row=>row.conversation_id===chatId)).toBe(true);
 expect(new Set(all.map(row=>row.mode))).toEqual(new Set(['generate','edit']));
 expect(app.db.sqlite.prepare('SELECT balance FROM image_wallets WHERE user_id=?').get('image-chat-reload').balance).toBe(78);
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
});
