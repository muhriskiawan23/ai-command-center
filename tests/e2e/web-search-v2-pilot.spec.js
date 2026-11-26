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

test("the Doha follow-up opens its cited source", async ({ page, app, context }) => {
  const firstQuestion = "Cari agensi di Jakarta untuk kerja perhotelan di Timur Tengah.";
  const followUp = "Kalau posisi di Doha?";
  const dohaQuery = "Agensi di Jakarta untuk posisi kerja perhotelan di Doha, Qatar";
  const dohaUrl = "https://example.com/doha-careers";
  const queries = [];
  const answer = "Sumber simulasi mencantumkan posisi resepsionis hotel di Doha.";
  Object.assign(app.env, {
    BOR_WEB_SEARCH_USER_DAILY_CALLS: "2",
    BOR_WEB_SEARCH_DAILY_CALLS: "2",
    BOR_WEB_SEARCH_DAILY_MICRO_USD: "520000",
    BOR_WEB_SEARCH_MONTHLY_MICRO_USD: "520000"
  });
  app.env.AI = { async run(_model, options) {
    const { prompt, previous } = JSON.parse(options.messages[1].content);
    const isDoha = prompt === followUp && previous.includes(firstQuestion);
    return { response: JSON.stringify({
      search: prompt === firstQuestion || isDoha,
      category: "general",
      query: isDoha ? dohaQuery : firstQuestion
    }) };
  } };
  app.env.WEB_SEARCH_V2_FETCHER = async (_url, init) => {
    const { question } = JSON.parse(JSON.parse(init.body).input);
    queries.push(question);
    const isDoha = question === dohaQuery;
    const text = isDoha ? answer : "Sumber simulasi memuat agensi perhotelan di Jakarta.";
    const urls = isDoha ? [dohaUrl, "https://example.org/doha-careers"] :
      ["https://example.com/jakarta-agencies", "https://example.org/jakarta-agencies"];
    return Response.json({ status: "completed", output: [
      { type: "web_search_call", status: "completed" },
      { type: "message", role: "assistant", content: [{ type: "output_text", text,
        annotations: urls.map(url => ({
          type: "url_citation", url, title: "Sumber simulasi", start_index: 0, end_index: text.length
        }))
      }] }
    ] });
  };
  await context.route(dohaUrl, route => route.fulfill({
    contentType: "text/html",
    body: "<title>Doha careers fixture</title><h1>Doha careers fixture</h1>"
  }));
  await loginAs(context, app, { id: "release-pilot", email: "release-pilot@example.invalid" });
  await page.goto(app.url);
  await page.locator("#prompt").fill(firstQuestion);
  await page.locator("#send").click();
  const latest = page.locator(".message.assistant .message-text").last();
  await expect(latest.getByRole("link", { name: "[1]", exact: true })).toHaveAttribute("href", "https://example.com/jakarta-agencies");
  await expect(page.locator("#send")).toBeEnabled();
  await page.locator("#prompt").fill(followUp);
  await page.locator("#send").click();
  await expect(latest).toContainText(answer);
  const citation = latest.getByRole("link", { name: "[1]", exact: true });
  await expect(citation).toHaveAttribute("href", dohaUrl);
  const [source] = await Promise.all([page.waitForEvent("popup"), citation.click()]);
  await expect(source).toHaveURL(dohaUrl);
  await expect(source.getByRole("heading", { name: "Doha careers fixture" })).toBeVisible();
  expect(queries).toEqual([firstQuestion, dohaQuery]);
});
