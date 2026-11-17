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
