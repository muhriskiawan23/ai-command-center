import {test,expect,loginAs,drawerMode} from "./fixtures.js";

test("catalog preserves approved prices and distinguishes local tools from inactive paid AI",async({page,app})=>{
  await page.goto(app.url+"/paket.html");
  await expect(page.locator("#plan-basic").locator("..")).toContainText("US$1,99");
  await expect(page.locator("#plan-pro").locator("..")).toContainText("US$6,99");
  await expect(page.getByRole("heading",{name:"Satu langganan, manfaat otomatis"})).toBeVisible();
  await expect(page.getByRole("table",{name:"Manfaat media setiap paket dan status ketersediaannya"})).toBeVisible();
  await expect(page.getByText("Belum dibuka untuk pembelian:")).toBeVisible();
  await expect(page.locator("select,form,button")).toHaveCount(0);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  await page.getByRole("link",{name:"Pratinjau Media Lab",exact:true}).click();
  await expect(page.getByRole("heading",{name:/Studio foto/})).toBeVisible();
  expect(app.aiCalls).toHaveLength(0);
});
test("Free catalog entry opens Guest chat and the local studio without payment or AI calls",async({page,app})=>{
  await page.goto(app.url+"/paket.html");
  await page.getByRole("link",{name:"Mulai chat Free — tanpa bayar",exact:true}).click();
  await expect(page.locator("#app")).toBeVisible();
  await expect(page.locator("#signOut")).toBeHidden();
  if(drawerMode(page))await page.locator("#menuBtn").click();
  await page.getByRole("link",{name:"Media Lab lokal",exact:true}).click();
  await expect(page.getByRole("heading",{name:/Studio foto/})).toBeVisible();
  expect(app.aiCalls).toHaveLength(0);
});
test("Free catalog entry preserves an authenticated account instead of opening Guest",async({page,context,app})=>{
  const user={id:"pricing-media-user",email:"pricing-media@example.test",name:"Penguji Media"};
  await loginAs(context,app,user);await page.goto(app.url+"/paket.html");
  await page.getByRole("link",{name:"Mulai chat Free — tanpa bayar",exact:true}).click();
  await expect(page.locator("#app")).toBeVisible();
  if(drawerMode(page))await page.locator("#menuBtn").click();
  await expect(page.locator("#signOut")).toBeVisible();
  const me=await context.request.get(app.url+"/api/auth/me");
  expect((await me.json()).user.id).toBe(user.id);
  expect(app.aiCalls).toHaveLength(0);
});
