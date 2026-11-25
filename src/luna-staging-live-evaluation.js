import { planWebSearch, runWebSearchV2 } from "./web-search-v2.js";

const OPENAI = "https://api.openai.com/v1/responses";
const MODEL = "gpt-6-luna";
const MAX_SEARCH_TOOL_CALLS = 2;
const RESERVATION_PER_SEARCH = 150000;
const SCENARIOS = [
  "Agensi kerja perhotelan di Timur Tengah yang ada di Jakarta.",
  "Kalau yang mencantumkan penempatan Saudi saja, mana yang aktif? Bedakan izin agensi, riwayat penempatan, dan lowongan yang masih buka."
];

function metricsOf(data) {
  const usage = data?.usage;
  if (!Number.isInteger(usage?.input_tokens) || !Number.isInteger(usage?.output_tokens)) return null;
  return {
    input: usage.input_tokens,
    output: usage.output_tokens,
    cachedInput: usage.input_tokens_details?.cached_tokens || 0,
    reasoning: usage.output_tokens_details?.reasoning_tokens || 0,
    webCalls: Array.isArray(data.output) ? data.output.filter(item => item.type === "web_search_call").length : 0
  };
}

const COST_ERRORS = new Set(["insufficient_quota", "billing_hard_limit_reached", "project_spend_limit_exceeded", "rate_limit_exceeded"]);

async function capture(response, phase, evidence) {
  const record = { phase, httpStatus: response.status, usage: null };
  evidence.push(record);
  if (Number(response.headers.get("content-length")) > 256 * 1024) return null;
  const data = await response.json().catch(() => null);
  record.usage = metricsOf(data);
  record.requestId = response.headers.get("x-request-id") || null;
  if (COST_ERRORS.has(data?.error?.code)) record.error = data.error.code;
  if (["max_output_tokens", "content_filter"].includes(data?.incomplete_details?.reason)) record.incomplete = data.incomplete_details.reason;
  return data;
}

export async function runLunaStagingEvaluation(env, fetcher = fetch) {
  const id = env.BOR_LUNA_LIVE_EVAL_ID;
  const expires = Number(env.BOR_LUNA_LIVE_EVAL_EXPIRES_AT);
  if (!/^web-v2-[a-z0-9-]{8,60}$/.test(id || "") || !Number.isSafeInteger(expires) ||
      Date.now() >= expires || !env.BOR_TEXT_BACKUP_API_KEY || !env.DB?.prepare) return;

  const claimed = await env.DB.prepare("INSERT OR IGNORE INTO web_search_v2_live_evaluation (id, status) VALUES (?, 'running') RETURNING id").bind(id).first();
  if (!claimed) return;

  const results = [];
  const evidence = [];
  let stopped = null;
  try {
    const history = [];
    for (const prompt of SCENARIOS) {
      const ai = { async run(_model, payload) {
        const response = await fetcher(OPENAI, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(12000),
          headers: { "Content-Type": "application/json", Authorization: "Bearer " + env.BOR_TEXT_BACKUP_API_KEY },
          body: JSON.stringify({ model: MODEL, input: payload.messages, store: false, reasoning: { effort: "none" }, max_output_tokens: 220 })
        });
        const data = await capture(response, "router", evidence);
        const text = data?.output?.flatMap(item => item.type === "message" ? item.content : [])
          .find(item => item?.type === "output_text")?.text;
        return { response: response.ok ? text || "" : "" };
      } };
      const plan = await planWebSearch(ai, prompt, history);
      const row = { scenario: results.length + 1, automaticSearch: Boolean(plan), plan: plan || null };
      results.push(row);
      if (!plan || !evidence.at(-1)?.usage) { stopped = "router_unverified"; break; }
      let attempted = false;
      const answer = await runWebSearchV2({
        DB: env.DB,
        BOR_WEB_SEARCH_MODE: "v2",
        BOR_WEB_SEARCH_OPENAI_KEY: env.BOR_TEXT_BACKUP_API_KEY,
        BOR_WEB_SEARCH_DAILY_CALLS: "2",
        BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: String(RESERVATION_PER_SEARCH),
        BOR_WEB_SEARCH_DAILY_MICRO_USD: String(RESERVATION_PER_SEARCH * 2),
        BOR_WEB_SEARCH_MONTHLY_MICRO_USD: String(RESERVATION_PER_SEARCH * 2),
        async WEB_SEARCH_V2_FETCHER(url, options) {
          if (attempted || url !== OPENAI) throw Error("staging_attempt_limit");
          attempted = true;
          const payload = JSON.parse(options.body);
          payload.max_tool_calls = MAX_SEARCH_TOOL_CALLS;
          payload.reasoning = { effort: "low" };
          const response = await fetcher(url, { ...options, body: JSON.stringify(payload) });
          await capture(response.clone(), "search", evidence);
          return response;
        }
      }, plan, { singleOpenAiAttempt: true });
      row.answer = answer?.text || null;
      row.sources = answer?.links || [];
      row.corroborated = answer?.corroborated || false;
      if (!answer || !evidence.at(-1)?.usage) { stopped = attempted ? "search_unverified" : "search_admission_denied"; break; }
      history.push({ role: "user", content: prompt });
    }
  } catch {
    stopped = "staging_evaluation_error";
  }
  await env.DB.prepare("UPDATE web_search_v2_live_evaluation SET status = ?, evidence_json = ? WHERE id = ?")
    .bind(stopped ? "stopped" : "completed", JSON.stringify({ stopped, results, evidence }), id).run();
}
