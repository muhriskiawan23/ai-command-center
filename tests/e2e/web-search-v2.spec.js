import { test, expect, loginAs } from "./fixtures.js";

const text = "Hotel Doha Example recruiters posted a synthetic opening.";
const citation = (url, content) => ({ type: "url_citation", url, title: "Example", start_index: 0, end_index: content.length });

test.use({ harnessOptions: { extraEnv: {
  BOR_WEB_SEARCH_MODE: "v2", BOR_WEB_SEARCH_OPENAI_KEY: "mock-key", BOR_WEB_SEARCH_OPENAI_MODEL: "mock-openai",
  BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: "20", BOR_WEB_SEARCH_DAILY_CALLS: "5",
  BOR_WEB_SEARCH_DAILY_MICRO_USD: "200", BOR_WEB_SEARCH_MONTHLY_MICRO_USD: "500",
  BOR_WEB_SEARCH_GOOGLE_KEY: "mock-google", BOR_WEB_SEARCH_GOOGLE_MODEL: "mock-google",
  BOR_WEB_SEARCH_GOOGLE_CALL_MICRO_USD: "20", BOR_WEB_SEARCH_GOOGLE_ELIGIBILITY_APPROVED: "true", BOR_WEB_SEARCH_GOOGLE_ALLOWED_USER_IDS: "search-e2e"
} } });

async function openChat(page, app, context) {
  app.control.aiText = '{"search":true,"category":"jobs","query":"Open hotel jobs in Doha, Qatar"}';
  if (context) await loginAs(context, app, { id: "search-e2e", email: "e2e@example.invalid" });
  await page.goto(app.url);
  if (!context) await page.locator("#continueGuest").click();
  await page.locator("#prompt").fill("Are there hotel jobs in Doha?");
  await page.locator("#send").click();
}

test("actual provider activity appears before the response and inline sources are clickable", async ({ page, app }) => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  app.env.WEB_SEARCH_V2_FETCHER = async () => {
    await gate;
    return Response.json({ status: "completed", output: [
      { type: "web_search_call", status: "completed" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text,
        annotations: [citation("https://example.com/job", text), citation("https://example.org/report", text)] }] }
    ] });
  };
  await openChat(page, app);
  try {
    await expect(page.locator('#typing [role="status"]')).toContainText(/OpenAI/);
  } finally { release(); }
  const answer = page.locator(".message.assistant .message-text");
  await expect(answer).toContainText(text);
  await expect(answer.getByRole("link", { name: "[1]", exact: true })).toHaveAttribute("href", "https://example.com/job");
  await expect(answer.getByRole("link", { name: "[2]", exact: true })).toHaveAttribute("href", "https://example.org/report");
  await expect(page.locator(".tool-activity")).toHaveCount(1);
});

test("Google failover displays citations and the original suggestions in an opaque sandbox", async ({ page, app, context }) => {
  app.env.WEB_SEARCH_V2_FETCHER = async url => url.includes("openai.com") ? new Response(null, { status: 429 }) :
    Response.json({ status: "completed", steps: [
      { type: "google_search_result", result: [{ search_suggestions: '<style>.chip{color:blue}</style><div><a class="chip" target="_blank" href="https://www.google.com/search?q=Doha">Doha search</a></div>' }] },
      { type: "model_output", content: [{ type: "text", text, annotations: [citation("https://example.com/job", text)] }] }
    ] });
  await openChat(page, app, context);
  const widget = page.locator("iframe.grounded-google-widget");
  await expect(widget).toHaveAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
  await expect(page.frameLocator("iframe.grounded-google-widget").getByRole("link", { name: "Doha search" }))
    .toHaveAttribute("href", "https://www.google.com/search?q=Doha");
  await expect(page.locator(".grounded-google-text")).toBeVisible();
  await expect(page.locator(".grounded-google-text").getByRole("link")).toHaveAttribute("href", "https://example.com/job");
});

test("unsafe Google suggestion gets rejected before any Grounding result is displayed", async ({ page, app, context }) => {
  app.env.WEB_SEARCH_V2_FETCHER = async url => url.includes("openai.com") ? new Response(null, { status: 429 }) :
    Response.json({ status: "completed", steps: [
      { type: "google_search_result", result: [{ search_suggestions: '<a target="_blank" href="https://example.org/">Unsafe suggestion</a>' }] },
      { type: "model_output", content: [{ type: "text", text, annotations: [citation("https://example.com/job", text)] }] }
    ] });
  await openChat(page, app, context);
  await expect(page.getByText(/could not be displayed|tidak dapat ditampilkan/i)).toBeVisible();
  await expect(page.locator(".grounded-google-text")).toBeHidden();
  await expect(page.locator("iframe.grounded-google-widget")).toHaveCount(0);
});
