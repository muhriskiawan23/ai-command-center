// Browser E2E on the real Worker, local D1 and AI stub. Every paid record
// below is FICTIONAL; no payment, gateway, paid model or remote D1 is used.
import { test, expect, loginAs, drawerMode } from "./fixtures.js";

test.use({ harnessOptions: { extraEnv: { PLAN_ENTITLEMENTS_ENABLED: "true" } } });
const USER={id:"plan-ui-test-user",email:"plan-ui@example.test",name:"Paket Uji"};
function seedPaid(app,tier){
  const now=Math.floor(Date.now()/1000);
  app.db.sqlite.prepare(
    "INSERT INTO verified_plan_payments "+
    "(order_id,user_id,purchased_tier,verification_status,verified_at,updated_at) "+
    "VALUES (?,?,?,?,?,?)"
  ).run("proof-ui-1",USER.id,tier,"verified_paid",now-60,now);
  app.db.sqlite.prepare(
    "INSERT INTO plan_entitlements "+
    "(user_id,paid_tier,payment_order_id,status,starts_at,ends_at,updated_at) "+
    "VALUES (?,?,?,?,?,?,?)"
  ).run(USER.id,tier,"proof-ui-1","active",now-100,now+3600,now);
}
async function reveal(page){
  if(drawerMode(page)) await page.locator("#menuBtn").click();
  await expect(page.locator("#planPanel")).toBeVisible();
}
test("guest can see Free but cannot select Basic or Pro",async({page,app})=>{
  await page.goto(app.url);
  await page.locator("#continueGuest").click();
  await reveal(page);
  await expect(page.locator("#planSelector")).toBeDisabled();
  await expect(page.locator("#planSelector option")).toHaveCount(1);
  await expect(page.locator("#planSelector")).toHaveValue("free");
});
test("Basic account only offers Free and Basic; Pro cannot be selected",async({page,context,app})=>{
  await loginAs(context,app,USER);
  seedPaid(app,"basic");
  await page.goto(app.url);
  await reveal(page);
  const selector=page.locator("#planSelector");
  await expect(selector).toBeEnabled();
  await expect(selector.locator("option")).toHaveCount(2);
  await expect(selector).toHaveValue("free");
  await selector.selectOption("basic");
  await expect(page.locator("#planStatus")).toContainText("Mode aktif: Basic");
  await expect(selector).toHaveValue("basic");
  const attacker=await context.request.post(app.url+"/api/plan/select",{
    data:{tier:"pro"},headers:{Origin:app.url}
  });
  expect(attacker.status()).toBe(403);
  await expect(selector.locator("option")).toHaveCount(2);
});
test("Pro may choose Basic, Free, Pro then refund immediately returns to Free",async({page,context,app})=>{
  await loginAs(context,app,USER);
  seedPaid(app,"pro");
  await page.goto(app.url);
  await reveal(page);
  const selector=page.locator("#planSelector");
  await expect(selector).toBeEnabled();
  await expect(selector.locator("option")).toHaveCount(3);
  await selector.selectOption("pro");
  await expect(page.locator("#planStatus")).toContainText("Mode aktif: Pro");
  await selector.selectOption("basic");
  await expect(page.locator("#planStatus")).toContainText("Mode aktif: Basic");
  await selector.selectOption("free");
  await expect(page.locator("#planStatus")).toContainText("Mode aktif: Free");
  await selector.selectOption("pro");
  await expect(page.locator("#planStatus")).toContainText("Mode aktif: Pro");
  app.db.sqlite.prepare(
    "UPDATE verified_plan_payments SET verification_status='refunded' WHERE order_id='proof-ui-1'"
  ).run();
  await page.reload();
  await reveal(page);
  await expect(page.locator("#planSelector")).toHaveValue("free");
  await expect(page.locator("#planSelector")).toBeDisabled();
  await expect(page.locator("#planSelector option")).toHaveCount(1);
});
test("backend verification error locks selector instead of forging Free entitlement",async({page,context,app})=>{
  await loginAs(context,app,USER);
  await page.route("**/api/plan",route=>route.fulfill({
    status:503,contentType:"application/json",body:'{"error":"proof unavailable"}'
  }));
  await page.goto(app.url);
  await reveal(page);
  await expect(page.locator("#planSelector")).toBeDisabled();
  await expect(page.locator("#planStatus")).toContainText("belum bisa diverifikasi");
});
