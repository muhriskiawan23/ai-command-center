// One-shot production vision diagnostic. Use ONLY a synthetic blue square.
// No user files, prompts, provider secrets, model outputs or API error messages
// are logged. This script makes at most one direct inference and one chat call.
const JPEG_B64 = "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCABAAEADASIAAhEBAxEB/8QAGAABAQEBAQAAAAAAAAAAAAAAAAUDCAf/xAAkEAACAgEBCAMAAAAAAAAAAAAAAwECBgQFFjZWdZSz0hEhQf/EABgBAQADAQAAAAAAAAAAAAAAAAABAwUH/8QAIxEAAgABDQAAAAAAAAAAAAAAAAECAwQREhQhMTNRUnGRsf/aAAwDAQACEQMRAD8A9/AM3vVpkMe9tFJVWbsYy0VrSsR8zMzP1ERH6EqbkDQEPfTFeZtjd+r2G+mK8zbG79XsX2WX2PpkVlqXAQ99MV5m2N36vYb6YrzNsbv1ewssvsfTFZalwGaHq1KFvQ2jUtrF1sXaLVvWY+YmJj6mJj9NChqi5kgh5pwJkPTNT4rFwh5pwJkPTNT4rF81z4OV6RFgccgA7UZoAAB2NhfAmPdM03iqXCHhfAmPdM03iqXDis6z4+X6aUOCBDzTgTIemanxWLhDzTgTIemanxWE1z4OV6IsDjkAHajNAAAOxsL4Ex7pmm8VS4Q8L4Ex7pmm8VS4cVnWfHy/TShwQM3oVqUMQ9VGpbWaMWysWresx8TExP1MTH4aAoTovRJD3LxXlnY3YK9RuXivLOxuwV6lwF9ql977ZFVaEPcvFeWdjdgr1G5eK8s7G7BXqXALVL732xVWhmhCtMhaEKopKqxRa11itaViPiIiI+oiI/DQAobpvZJ//9k=";
const image = "data:image/jpeg;base64," + JPEG_B64;
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const token = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const origin = "https://ai-command-center.muhriskiawan23.workers.dev";
const summary = { direct: null, chat: null };
if (!accountId || !token) {
  console.error("VISION_DIAGNOSTIC_CONFIG_MISSING");
  process.exit(2);
}
async function asJson(res) {
  try { return await res.json(); } catch { return null; }
}
try {
  const url = "https://api.cloudflare.com/client/v4/accounts/" + encodeURIComponent(accountId) +
    "/ai/run/@cf/moondream/moondream3.1-9B-A2B";
  const response = await fetch(url, {
    method: "POST",
    headers: { Authorization: "Bearer " + token, "Content-Type": "application/json" },
    body: JSON.stringify({
      task: "query", image, question: "What color is the central square?",
      reasoning: false, stream: false, max_tokens: 120
    }),
    signal: AbortSignal.timeout(45_000)
  });
  const payload = await asJson(response);
  summary.direct = {
    status: response.status,
    ok: response.ok && payload?.success === true && typeof payload?.result?.answer === "string" && !!payload.result.answer.trim(),
    errorCode: Number.isInteger(payload?.errors?.[0]?.code) ? payload.errors[0].code : null
  };
} catch (error) {
  summary.direct = { status: 0, ok: false, transportError: error?.name || "unknown" };
}
try {
  const response = await fetch(origin + "/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-BOR-Vision": "1" },
    body: JSON.stringify({
      message: "What color is the central square?", agent: "coordinator", language: "en",
      imageVision: {name:"synthetic-vision-check.jpg",dataUrl:image}
    }),
    signal: AbortSignal.timeout(115_000)
  });
  const body = await asJson(response);
  summary.chat = {
    status: response.status,
    ok: response.ok && typeof body?.response === "string" && body.response.trim().length > 0,
    code: typeof body?.code === "string" ? body.code.slice(0, 80) : null,
    stage: typeof body?.stage === "string" ? body.stage.slice(0, 80) : null,
    reason: typeof body?.reason === "string" ? body.reason.slice(0, 80) : null,
    responseKind: typeof body?.responseKind === "string" ? body.responseKind.slice(0, 80) : null
  };
} catch (error) {
  summary.chat = { status: 0, ok: false, transportError: error?.name || "unknown" };
}
console.log("SYNTHETIC_VISION_DIAGNOSTIC " + JSON.stringify(summary));
// A deployment token lacking REST inference scope does not necessarily block
// the Worker AI binding. Gate this check on the app's image chat result.
if (!summary.chat.ok) {
  console.error("PRODUCTION_VISION_SMOKE_FAILED");
  process.exitCode = 1;
}
