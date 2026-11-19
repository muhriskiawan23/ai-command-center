import {test,expect,loginAs} from './fixtures.js';
import {processImageJob} from '../../src/image-jobs.js';
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAQAAAAECAYAAACp8Z5+AAAAFUlEQVR4nGMUaTrxnwEJMDGgAcICAJqcAmUgQSjSAAAAAElFTkSuQmCC','base64');
async function setupImages(app){
 const files=new Map();
 Object.assign(app.env,{BOR_IMAGES_ENABLED:'true',OPENAI_API_KEY:'synthetic-test-key',IMAGE_CREDITS_GENERATE:'10',IMAGE_CREDITS_EDIT:'12',IMAGE_TARIFF_VERSION:'test-v1',IMAGE_QUEUE:{send:async body=>{setTimeout(()=>processImageJob(app.env,body.id),20);}},IMAGE_FETCHER:async()=>Response.json({data:[{b64_json:png.toString('base64')}]}),IMAGE_FILES:{put:async(key,bytes)=>files.set(key,Buffer.from(bytes)),get:async key=>{const bytes=files.get(key);return bytes?{body:bytes,arrayBuffer:async()=>bytes}:null;},delete:async keys=>{for(const key of Array.isArray(keys)?keys:[keys])files.delete(key);}}});
 app.db.sqlite.prepare('INSERT INTO image_wallets VALUES (?,?,?)').run('image-e2e',100,1);
}
async function openTools(page){if(!await page.locator('#toolsMenu').evaluate(el=>el.open))await page.locator('#toolsMenu > summary').click();}
test('generate, preview, download, reload gallery and edit previous image',async({page,context,app})=>{
 await loginAs(context,app,{id:'image-e2e',email:'image-e2e@example.test'});await setupImages(app);await page.goto(app.url);
 await page.locator('#prompt').fill('Buat poster promo top up game');await page.locator('#send').click();
 await expect(page.locator('#imageDialog')).toBeVisible();await expect(page.locator('#imageQuote')).toContainText('10 kredit');
 await page.locator('#imageConfirm').click();await expect(page.locator('.image-result img')).toBeVisible({timeout:10000});await expect.poll(()=>page.locator('.image-result img').evaluate(img=>img.naturalWidth)).toBe(4);
 const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:'Download',exact:true}).click();const download=await downloadPromise;expect(download.suggestedFilename()).toMatch(/\.png$/);
 await page.reload();await openTools(page);await page.locator('#openImageGallery').click();await expect(page.locator('#imageGallery img')).toBeVisible();
 await page.getByRole('button',{name:'Edit lagi',exact:true}).click();await page.locator('#prompt').fill('Ganti background jadi biru');await page.locator('#send').click();await expect(page.locator('#imageQuote')).toContainText('12 kredit');await page.locator('#imageConfirm').click();await expect(page.locator('#messages .image-result img')).toBeVisible({timeout:10000});
 expect(app.db.sqlite.prepare('SELECT balance FROM image_wallets').get().balance).toBe(78);
 const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
});
test('guest generation shows honest sign-in notice without calling chat or paid API',async({page,app})=>{
 await page.goto(app.url);await page.locator('#continueGuest').click();await page.locator('#prompt').fill('Buat poster promosi');await page.locator('#send').click();await expect(page.locator('#toast')).toContainText('Masuk dengan akun Google');expect(app.aiCalls.length).toBe(0);await expect(page.locator('#imageDialog')).not.toBeVisible();
});
