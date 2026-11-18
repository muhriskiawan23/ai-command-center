import {test,expect,loginAs} from "./fixtures.js";
const URL="https://demo.playwright.dev/todomvc/";
async function openPanel(page){
 await page.locator("#toolsMenu > summary").click();
 await page.locator("#openBrowserTool").click();
 await expect(page.locator("#browserDialog")).toBeVisible();
}
test("browser beta is visible but refuses network jobs before owner enables private service binding",async({page,app})=>{
 await page.goto(app.url);
 await page.locator("#continueGuest").click();
 await openPanel(page);
 await expect(page.locator("#browserDialog")).toContainText("persetujuan");
 await page.locator("#browserUrl").fill(URL);
 await page.locator("#browserInspect").click();
 await expect(page.locator("#browserStatus")).toContainText("belum diaktifkan");
 await expect(page.locator("#browserPageResult")).toBeHidden();
 expect(app.aiCalls).toHaveLength(0);
});
test("signed-in beta can inspect allowed page and execute only a reviewed, user-confirmed action",async({page,context,app})=>{
 const calls=[];
 Object.assign(app.env,{
   BROWSER_AGENT_ENABLED:"true",BROWSER_AGENT_ALLOWED_HOSTS:"demo.playwright.dev",
   BROWSER_AGENT_TOKEN:"t".repeat(40),BROWSER_APPROVAL_SECRET:"s".repeat(40),
   BROWSER_AGENT_DAILY_USER_JOBS:"2",BROWSER_AGENT_DAILY_GLOBAL_JOBS:"10",
   BROWSER_AGENT:{async fetch(_url,request){
    const plan=JSON.parse(request.body);calls.push(plan);
    return Response.json({ok:true,host:"demo.playwright.dev",url:URL,title:"TodoMVC",
      text:"What needs to be done? Test items",
      elements:[{role:"button",by:"role",name:"Clear completed"}],
      stepsExecuted:plan.steps.length,truncated:false});
   }}
 });
 await loginAs(context,app,{id:"browser-e2e-user",email:"browser@example.test",name:"Browser Tester"});
 await page.goto(app.url);
 await openPanel(page);
 await page.locator("#browserUrl").fill(URL);
 await page.locator("#browserInspect").click();
 await expect(page.locator("#browserPageResult")).toBeVisible();
 await expect(page.locator("#browserPageTitle")).toHaveText("TodoMVC");
 expect(calls).toHaveLength(1);
 await page.locator("#browserTarget").selectOption("0");
 await page.locator("#browserReview").click();
 await expect(page.locator("#browserApproval")).toBeVisible();
 await expect(page.locator("#browserPlanReview")).toContainText("Clear completed");
 expect(calls).toHaveLength(1);
 await page.locator("#browserExecute").click();
 await expect(page.locator("#browserApproval")).toBeHidden();
 await expect(page.locator("#browserStatus")).toContainText("Langkah selesai");
 expect(calls).toHaveLength(2);
 expect(calls[1].steps).toHaveLength(1);
 await page.locator("#browserCopyToChat").click();
 await expect(page.locator("#browserDialog")).toBeHidden();
 await expect(page.locator("#prompt")).toContainText("Sumber browser");
 expect(app.aiCalls).toHaveLength(0);
});
