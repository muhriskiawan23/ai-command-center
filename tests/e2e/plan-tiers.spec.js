// Synthetic-only browser verification of fixed subscription tiers.
// Real Worker, ephemeral local D1, stub model, no Midtrans calls.
import {test,expect,loginAs,drawerMode} from "./fixtures.js";
test.use({harnessOptions:{extraEnv:{PLAN_ENTITLEMENTS_ENABLED:"true"}}});
const USER={id:"plan-ui-test-user",email:"plan-ui@example.test",name:"Paket Uji"};
function seedPaid(app,tier){
  const now=Math.floor(Date.now()/1000);
  app.db.sqlite.prepare("INSERT INTO verified_plan_payments "+
    "(order_id,user_id,purchased_tier,verification_status,verified_at,updated_at) VALUES(?,?,?,?,?,?)"
  ).run("proof-ui-1",USER.id,tier,"verified_paid",now-60,now);
  app.db.sqlite.prepare("INSERT INTO plan_entitlements "+
    "(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) VALUES(?,?,?,?,?,?,?)"
  ).run(USER.id,tier,"proof-ui-1","active",now-100,now+3600,now);
}
async function reveal(page){
  if(drawerMode(page))await page.locator("#menuBtn").click();
  await expect(page.locator("#planPanel")).toBeVisible();
}
test("guest is Free with no tier-switch control",async({page,app})=>{
  await page.goto(app.url);
  await page.locator("#continueGuest").click();await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Free");
  await expect(page.locator("#planPanel")).not.toContainText("Mode aktif");
  await expect(page.locator("#planSelector")).toHaveCount(0);
});
test("Basic subscriber is automatically Basic, includes Free",async({page,context,app})=>{
  await loginAs(context,app,USER);seedPaid(app,"basic");
  await page.goto(app.url);await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Basic");
  await expect(page.locator("#planStatus")).toContainText("seluruh fitur Free");
  await expect(page.locator("#planSelector")).toHaveCount(0);
  const attempt=await context.request.post(app.url+"/api/plan/select",{
    data:{tier:"pro"},headers:{Origin:app.url}
  });expect(attempt.status()).toBe(404);
  await expect(page.locator("#planBadge")).toHaveText("Basic");
});
test("Pro subscriber stays Pro across reloads; refund revokes Pro",async({page,context,app})=>{
  await loginAs(context,app,USER);seedPaid(app,"pro");
  await page.goto(app.url);await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Pro");
  await expect(page.locator("#planStatus")).toContainText("seluruh fitur Basic dan Free");
  await expect(page.locator("#planSelector")).toHaveCount(0);
  await page.reload();await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Pro");
  app.db.sqlite.prepare(
    "UPDATE verified_plan_payments SET verification_status='refunded' WHERE order_id='proof-ui-1'"
  ).run();
  await page.reload();await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Free");
});
test("failed entitlement lookup never displays an invented paid subscription",async({page,context,app})=>{
  await loginAs(context,app,USER);
  await page.route("**/api/plan",route=>route.fulfill({
    status:503,contentType:"application/json",body:'{"error":"proof unavailable"}'
  }));
  await page.goto(app.url);await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Belum terverifikasi");
  await expect(page.locator("#planStatus")).toContainText("tetap terkunci");
});
test("returning to the tab rechecks a refunded subscription without a page reload",async({page,context,app})=>{
  await loginAs(context,app,USER);seedPaid(app,"pro");
  await page.goto(app.url);await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Pro");
  app.db.sqlite.prepare("UPDATE verified_plan_payments SET verification_status='refunded'").run();
  await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
  await expect(page.locator("#planBadge")).toHaveText("Free");
});
test("an open tab rechecks the package when the server entitlement expires",async({page,context,app})=>{
  await loginAs(context,app,USER);seedPaid(app,"pro");
  app.db.sqlite.prepare("UPDATE plan_entitlements SET ends_at=?").run(Math.floor(Date.now()/1000)+3);
  await page.goto(app.url);await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Pro");
  await expect(page.locator("#planBadge")).toHaveText("Free",{timeout:8000});
});
test("the package comparison link opens an existing honest catalog with no mode selector",async({page,app})=>{
  await page.goto(app.url);await page.locator("#continueGuest").click();await reveal(page);
  await page.locator("#planPanel > summary").click();
  await page.locator("#planPanel a").click();
  await expect(page).toHaveURL(app.url+"/paket.html");
  await expect(page.getByRole("heading",{name:"Satu langganan, manfaat otomatis"})).toBeVisible();
  await expect(page.getByRole("table",{name:"Harga dan manfaat Free, Basic dan Pro"})).toBeVisible();
  await expect(page.getByRole("table",{name:"Manfaat media setiap paket dan status ketersediaannya"})).toBeVisible();
  await expect(page.locator("#plan-basic").locator("..")).toContainText("US$1,99");
  await expect(page.locator("#plan-pro").locator("..")).toContainText("US$6,99");
  await expect(page.getByText("Belum dibuka untuk pembelian:")).toBeVisible();
  await expect(page.locator("select,button,form")).toHaveCount(0);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);
  expect(overflow).toBe(false);
});
test("the catalog Free link starts Guest chat without checkout or a subscription",async({page,app})=>{
  await page.goto(app.url+"/paket.html");
  await page.getByRole("link",{name:"Mulai chat Free — tanpa bayar",exact:true}).click();
  await expect(page.locator("#app")).toBeVisible();await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Free");
  await expect(page.locator("#signOut")).toBeHidden();
  expect(app.db.sqlite.prepare("SELECT COUNT(*) n FROM verified_plan_payments").get().n).toBe(0);
  expect(app.aiCalls).toHaveLength(0);
});
test("the catalog Free link preserves an existing Pro account and its server entitlement",async({page,context,app})=>{
  await loginAs(context,app,USER);seedPaid(app,"pro");
  await page.goto(app.url+"/paket.html");
  await page.getByRole("link",{name:"Mulai chat Free — tanpa bayar",exact:true}).click();
  await expect(page.locator("#app")).toBeVisible();await reveal(page);
  await expect(page.locator("#planBadge")).toHaveText("Pro");
  await expect(page.locator("#signOut")).toBeVisible();
  const me=await context.request.get(app.url+"/api/auth/me");
  expect((await me.json()).user.id).toBe(USER.id);
  expect(app.aiCalls).toHaveLength(0);
});
