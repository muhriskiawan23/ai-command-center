import { test, expect, loginAs } from "./fixtures.js";

test("BOR AI proposes usable Google Forms script without claiming account-level creation",async({page,app})=>{
  app.control.aiText="Berikut rancangan survei masukan untuk BOR AI. Jalankan script setelah kamu meninjaunya.";
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await expect(page.locator("#prompt")).toBeVisible();
  await page.locator("#prompt").fill("Buatkan formulir feedback dan saran publik untuk BOR AI");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  const panel=page.locator(".message.assistant .form-draft");
  await expect(panel).toBeVisible();
  await expect(panel).toContainText("Belum dibuat di Google");
  await expect(panel.getByRole("button",{name:"Salin Google Apps Script"})).toBeVisible();
  await expect(panel.getByRole("link",{name:"Buka Google Apps Script"})).toHaveAttribute("href","https://script.google.com/home/projects/create");
  expect(app.aiCalls).toHaveLength(1);
});

test("ordinary chat does not fabricate a Google Forms tool or a web search",async({page,app})=>{
  app.control.aiText="Dua belas dikali empat belas sama dengan 168.";
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await page.locator("#prompt").fill("Berapa hasil 12 x 14?");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant:not(#typing)")).toHaveCount(1);
  await expect(page.locator(".form-draft")).toHaveCount(0);
  await expect(page.locator(".tool-activity")).toHaveCount(0);
});


test("Google Forms direct creation requires explicit click, Google OAuth consent and creates unpublished form",async({page,context,app})=>{
  app.control.aiText="Berikut rancangan survei masukan yang dapat kamu buat setelah memberikan izin Google.";
  await loginAs(context,app,{id:"forms-test-user",email:"forms-user@example.test",name:"Forms Tester"});
  let requests=0;
  await page.route("https://forms.googleapis.com/**",async route=>{
    requests++;
    const url=route.request().url();
    if(url.endsWith("unpublished=true")){
      await route.fulfill({status:200,contentType:"application/json",body:JSON.stringify({formId:"abcdefghijkl123456"})});
    }else if(url.endsWith(":batchUpdate")){
      const request=JSON.parse(route.request().postData());
      expect(request.requests.length).toBe(9);
      await route.fulfill({status:200,contentType:"application/json",body:'{"replies":[]}'});
    }else await route.fulfill({status:404,body:"not found"});
  });
  await page.goto(app.url);
  await expect(page.locator("#prompt")).toBeVisible();
  await page.evaluate(()=>{
    window.google.accounts.oauth2={
      hasGrantedAllScopes:(reply,scope)=>reply.scope===scope,
      initTokenClient(options){
        return {requestAccessToken(){
          options.callback({access_token:"test_google_access_token_12345",scope:options.scope});
        }};
      }
    };
  });
  await page.locator("#prompt").fill("Buatkan formulir feedback dan saran publik untuk BOR AI");
  await page.locator("#send").click();
  const panel=page.locator(".message.assistant .form-draft");
  await expect(panel).toBeVisible();
  expect(requests).toBe(0);
  page.once("dialog",dialog=>dialog.accept());
  await panel.getByRole("button",{name:"Buat langsung di Google Forms"}).click();
  const result=panel.getByRole("link",{name:"Buka Google Form baru (belum dipublikasikan)"});
  await expect(result).toBeVisible();
  await expect(result).toHaveAttribute("href","https://docs.google.com/forms/d/abcdefghijkl123456/edit");
  expect(requests).toBe(2);
  await expect(panel).toContainText("masih belum menerima respons");
});

test("guest user cannot create Google Forms by merely clicking draft button",async({page,app})=>{
  app.control.aiText="Form publik siap untuk ditinjau dalam bentuk script.";
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await page.locator("#prompt").fill("Buatkan formulir feedback dan saran publik untuk BOR AI");
  await page.locator("#send").click();
  const panel=page.locator(".message.assistant .form-draft");
  await expect(panel).toBeVisible();
  await panel.getByRole("button",{name:"Buat langsung di Google Forms"}).click();
  await expect(panel.locator("a[href*='/forms/d/']")).toHaveCount(0);
  await expect(panel).toContainText("Belum dibuat di Google");
});
