import {test,expect,openSettings,drawerMode} from './fixtures.js';
async function enter(page,app){await page.goto(app.url);await page.locator('#continueGuest').click();await expect(page.locator('#prompt')).toBeVisible();}
test('workspace uses the original logo, readable light surfaces and a bounded viewport',async({page,app})=>{
 await enter(page,app);
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 await expect(page.locator('.welcome-logo-img')).toHaveAttribute('src','/logo-mark.svg');
 await expect(page.locator('.brand-logo')).toHaveAttribute('src','/logo-mark.svg');
 await expect(page.locator('.suggestion')).toHaveCount(4);
 await expect(page.locator('#planSelector')).toHaveCount(0);
 const sizes=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,send:document.querySelector('#send').getBoundingClientRect().right}));
 expect(sizes.scroll).toBeLessThanOrEqual(sizes.width);expect(sizes.send).toBeLessThanOrEqual(sizes.width);
 expect(app.aiCalls).toHaveLength(0);
});
test('attachment and tools disclosures support Escape without dispatching AI',async({page,app})=>{
 await enter(page,app);
 await page.locator('#attachmentMenu > summary').click();await expect(page.locator('#attachPdf')).toBeVisible();await expect(page.locator('#attachCsv')).toBeHidden();
 await page.locator('#attachmentMenu > summary').press('Escape');await expect(page.locator('#attachPdf')).toBeHidden();await expect(page.locator('#attachmentMenu > summary')).toBeFocused();
 await page.locator('#toolsMenu > summary').click();await expect(page.locator('#agent')).toBeVisible();
 await page.locator('#toolsMenu > summary').press('Escape');await expect(page.locator('#agent')).toBeHidden();
 if(drawerMode(page)){await page.locator('#menuBtn').click();await expect(page.locator('#sidebar')).toBeVisible();}
 await page.locator('#openPlugins').click();await expect(page.locator('#pluginsDialog')).toBeVisible();
 await expect(page.locator('#pluginEmailUse')).toBeVisible();await page.locator('#pluginsClose').click();
 expect(app.aiCalls).toHaveLength(0);
});
test('appearance preference survives reload without persisting guest messages',async({page,app})=>{
 await enter(page,app);await openSettings(page);await page.locator('#themePreference').selectOption('dark');
 await expect(page.locator('html')).toHaveAttribute('data-theme','dark');
 await page.reload();await expect(page.locator('html')).toHaveAttribute('data-theme','dark');await expect(page.locator('#messages')).toBeHidden();
 await openSettings(page);await page.locator('#themePreference').selectOption('light');
 await expect(page.locator('html')).toHaveAttribute('data-theme','light');
 const saved=await page.evaluate(()=>Object.entries(localStorage));
 expect(saved.every(([key])=>['borai-theme-preference','borai-language-preference'].includes(key))).toBe(true);
 expect(app.aiCalls).toHaveLength(0);
});
test('attachment chooser remains reachable through the compact plus menu',async({page,app})=>{
 await enter(page,app);await page.locator('#attachmentMenu > summary').click();
 const pending=page.waitForEvent('filechooser');await page.locator('#attachPdf').click();
 const chooser=await pending;await chooser.setFiles({name:'preview.csv',mimeType:'text/csv',buffer:Buffer.from('Name,Value\nSample,42')});
 await expect(page.locator('#csvName')).toContainText('preview.csv');await expect(page.locator('#csvAttachment')).toBeVisible();
 await expect(page.locator('#attachmentMenu')).not.toHaveAttribute('open','');expect(app.aiCalls).toHaveLength(0);
});
