import { test, expect, loginAs, seedConversation, drawerMode, openSettings } from "./fixtures.js";
const ALICE={id:"account-experience-alice",name:"Alice",email:"alice@example.test"};

async function openSidebar(page) {
 if (drawerMode(page)) await page.locator("#menuBtn").click();
}

test("settings only contain language, appearance, archive and delete-history controls", async ({page,app})=>{
 await page.goto(app.url);await page.locator("#continueGuest").click();await openSettings(page);
 await expect(page.locator("#workspaceSettings #themePreference")).toBeVisible();
 await expect(page.locator("#workspaceSettings .language-picker")).toBeVisible();
 await expect(page.locator("#workspaceSettings #toggleArchived")).toBeVisible();
 await expect(page.locator("#workspaceSettings #clearHistory")).toBeVisible();
 for(const id of ["openUsage","openMemory","openIntegrations","about","signOut"]) {
  await expect(page.locator("#workspaceSettings #"+id)).toHaveCount(0);
 }
 await expect(page.locator("#userProfile")).toBeHidden();
 expect(app.aiCalls).toHaveLength(0);
});

test("signed-in account opens accessible profile and privacy center on every viewport",async({page,context,app})=>{
 await loginAs(context,app,ALICE);await page.goto(app.url);
 await expect(page.locator("#prompt")).toBeVisible();await openSidebar(page);
 await page.locator("#userProfile").click();
 await expect(page.locator("#accountDialog")).toBeVisible();
 await expect(page.locator("#accountName")).toHaveText("Alice");
 await expect(page.locator("#accountEmail")).toHaveText("alice@example.test");
 await expect(page.locator("#openMemory")).toBeVisible();
 await expect(page.locator("#openIntegrations")).toBeVisible();
 await expect(page.locator("#openUsage")).toBeVisible();
 await page.locator("#openPrivacy").click();
 await expect(page.locator("#privacyTitle")).toBeVisible();
 await expect(page.locator(".privacy-cards article")).toHaveCount(4);
 await expect(page.locator("#accountDialog")).toContainText(/External AI services|Layanan AI eksternal/);
 await page.locator("#accountBack").click();
 await expect(page.locator("#accountHome")).toBeVisible();
 await page.locator("#accountClose").click();
 await expect(page.locator("#accountDialog")).toBeHidden();
 const size=await page.evaluate(()=>({width:innerWidth,document:document.documentElement.scrollWidth}));
 expect(size.document).toBeLessThanOrEqual(size.width);
 expect(app.aiCalls).toHaveLength(0);
});

test("personalization is saved for the account and reaches AI only as lower-priority hint",async({page,context,app})=>{
 await loginAs(context,app,ALICE);await page.goto(app.url);await openSidebar(page);
 await page.locator("#userProfile").click();
 await page.locator("#openCustomization").click();
 await page.locator("#customNickname").fill("Budi");
 await page.locator("#customTone").selectOption("professional");
 await page.locator("#customLength").selectOption("short");
 await page.locator("#customizeForm button[type=submit]").click();
 await expect(page.locator("#customizeStatus")).toContainText(/Tersimpan|Saved on this device/);
 await page.locator("#accountClose").click();
 await page.locator("#prompt").fill("Halo");
 await page.locator("#send").click();
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 const last=app.aiCalls.at(-1);
 expect(last.messages[0].content).toContain("BOR AI CONFIDENTIALITY");
 const content=last.messages.at(-1).content;
 expect(content).toContain("USER PRESENTATION PREFERENCES");
 expect(content).toContain("Budi");
 const saved=await page.evaluate(()=>JSON.parse(localStorage.getItem("borai-customization:v1:account-experience-alice")));
 expect(saved).toEqual({nickname:"Budi",tone:"professional",length:"short"});
});

test("flat list Markdown and headings render safely without staircase indentation",async({page,app})=>{
 app.control.aiText="## Pengalaman Kerja\n- Grand Hyatt\n  - Kartika Chandra\n    * InterContinental\n\n**Pendidikan**\nS1 Manajemen.";
 await page.goto(app.url);await page.locator("#continueGuest").click();
 await page.locator("#prompt").fill("Ringkas pengalaman kerja");
 await page.locator("#send").click();
 await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
 const content=page.locator(".message.assistant .message-text");
 await expect(content.locator("h2")).toHaveText("Pengalaman Kerja");
 await expect(content.locator("ul > li")).toHaveCount(3);
 await expect(content.locator("ul ul")).toHaveCount(0);
 await expect(content.locator("strong")).toContainText("Pendidikan");
 const widths=await page.evaluate(()=>({doc:document.documentElement.scrollWidth,viewport:innerWidth}));
 expect(widths.doc).toBeLessThanOrEqual(widths.viewport);
});

test("Integrations and About return to Profile on X without null-control errors",async({page,context,app})=>{
 await loginAs(context,app,ALICE);
 const exceptions=[];page.on("pageerror",e=>exceptions.push(e.message));
 await page.goto(app.url);await expect(page.locator("#prompt")).toBeVisible();
 await openSidebar(page);await page.locator("#userProfile").click();
 await page.locator("#openIntegrations").click();
 await expect(page.locator("#integrationsDialog")).toBeVisible();
 await expect(page.locator("#githubConnectionMessage")).not.toContainText("Cannot set properties of null");
 await page.locator("#integrationsClose").click();
 await expect(page.locator("#accountDialog")).toBeVisible();
 await page.locator("#about").click();
 await expect(page.locator("#aboutDialog")).toBeVisible();
 await page.locator("#aboutClose").click();
 await expect(page.locator("#accountDialog")).toBeVisible();
 await expect(page.locator("#accountHome")).toBeVisible();
 expect(exceptions).toEqual([]);
});
async function selectLanguageAndAwaitReload(page,language) {
 const load=page.waitForEvent("load",{timeout:20000});
 await page.locator("#languagePreference").selectOption(language);
 await load;
 // A transient synthetic backend 503 shows the retry gate instead of authenticated chat.
 if (await page.locator("#gateRetry").isVisible()) await page.locator("#gateRetry").click();
 await expect(page.locator("#prompt")).toBeVisible({timeout:20000});
}
test("English and Indonesian account labels plus known generic history titles follow language preference",async({page,context,app})=>{
 await loginAs(context,app,ALICE);
 seedConversation(app.db,{id:"conv-title-rinkas-1",userId:ALICE.id,title:"ringkas",updatedAt:100,messages:[{role:"user",content:"ringkas"},{role:"assistant",content:"halo"}]});
 await page.goto(app.url);await expect(page.locator("#prompt")).toBeVisible();
 await openSidebar(page);await openSettings(page);
 await selectLanguageAndAwaitReload(page,"en");
 await openSidebar(page);await openSettings(page);
 await expect(page.locator("#toggleArchived")).toContainText("View archive");
 await expect(page.locator(".history-item")).toContainText("summarize");
 await page.locator("#userProfile").click();
 await expect(page.locator("#accountTitle")).toHaveText("User profile");
 await page.locator("#openPrivacy").click();await expect(page.locator("#privacyTitle")).toHaveText("Privacy center");
 await page.locator("#accountClose").click();
 await openSidebar(page);await openSettings(page);
 await selectLanguageAndAwaitReload(page,"id");await openSidebar(page);await openSettings(page);
 await expect(page.locator("#toggleArchived")).toContainText("Lihat arsip");
 await expect(page.locator(".history-item")).toContainText("ringkas");
});
