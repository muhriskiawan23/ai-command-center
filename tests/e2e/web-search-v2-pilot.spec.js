import { test, expect, loginAs } from "./fixtures.js";

test.use({ harnessOptions: { extraEnv: {
  BOR_WEB_SEARCH_MODE: "v2",
  BOR_WEB_SEARCH_PILOT_USER_IDS: "release-pilot",
  BOR_WEB_SEARCH_USER_DAILY_CALLS: "1",
  BOR_WEB_SEARCH_DAILY_CALLS: "1",
  BOR_WEB_SEARCH_DAILY_MICRO_USD: "260000",
  BOR_WEB_SEARCH_MONTHLY_MICRO_USD: "260000",
  BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: "260000",
  BOR_WEB_SEARCH_OPENAI_KEY: "mock-key"
} } });

test("the signed-in pilot streams a cited Luna answer and the next search hits the quota", async ({ page, app, context }) => {
  const answer = "The synthetic release has a confirmed public announcement.";
  let calls = 0;
  app.control.aiText = JSON.stringify({ search: true, category: "technology", query: "What was announced in the public release?" });
  app.env.WEB_SEARCH_V2_FETCHER = async (_url, init) => {
    calls++;
    expect(JSON.parse(init.body).model).toBe("gpt-6-luna");
    return Response.json({ status: "completed", output: [
      { type: "web_search_call", status: "completed" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text: answer,
        annotations: ["https://example.com/release", "https://example.org/release"].map(url => ({
          type: "url_citation", url, title: "Synthetic release", start_index: 0, end_index: answer.length
        }))
      }] }
    ] });
  };
  await loginAs(context, app, { id: "release-pilot", email: "release-pilot@example.invalid" });
  await page.goto(app.url);
  await page.locator("#prompt").fill("What was announced in the public release?");
  await page.locator("#send").click();
  const first = page.locator(".message.assistant .message-text").last();
  await expect(first).toContainText(answer);
  await expect(first.getByRole("link", { name: "[1]", exact: true })).toHaveAttribute("href", "https://example.com/release");
  const reply = page.locator(".message.assistant").last();
  await expect(reply.locator(".message-link-sources")).toHaveCount(1);
  await expect(reply.locator(".message-link-sources .source")).toHaveCount(2);
  await expect(reply.locator(".message-link-sources .source").first()).toContainText("Synthetic release");
  await expect(reply.locator(".message-link-sources .source").first()).toContainText("example.com");
  expect(calls).toBe(1);
  await page.locator("#prompt").fill("What was added to the next public release?");
  await page.locator("#send").click();
  await expect(page.locator(".message.assistant .message-text").last()).toContainText(/could not find a citable answer|belum menemukan sumber/i);
  expect(calls).toBe(1);
});
