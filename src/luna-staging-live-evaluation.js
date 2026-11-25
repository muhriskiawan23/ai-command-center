import { planWebSearch, runWebSearchV2 } from "./web-search-v2.js";

const OPENAI = "https://api.openai.com/v1/responses";
const MODEL = "gpt-6-luna";
const MAX_SEARCH_TOOL_CALLS = 2;
const BUDGET_MICRO_USD = 500000;
// Luna long-context rates can apply to the full request.
const RESERVATION_PER_SEARCH = 240000;
const RESERVATION_PER_ROUTER = 106000;
const SCENARIOS = [
  "Agensi kerja perhotelan di Timur Tengah yang ada di Jakarta.",
  "Lowongan kerja perhotelan terbaru di Qatar. Cek situs resmi pemberi kerja, lokasi, dan apakah lamaran masih dibuka.",
  "Rekomendasikan dua ponsel Android baru dengan harga maksimal Rp3 juta di Indonesia. Cek harga dan ketersediaan terbaru dari penjual yang jelas.",
  "Apa berita internasional utama terbaru? Sertakan tanggal kejadian dan sumber resmi atau kantor berita.",
  "Di mana lokasi kantor pusat Qatar Airways di Doha? Cek nama perusahaan, alamat resmi, dan bedakan dari alamat bandara jika berbeda.",
  "Kalau yang di Doha saja, mana yang masih buka?"
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

function safeProviderCode(value) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,60}$/.test(value) ? value : undefined;
}

async function capture(response, phase, evidence) {
  const record = { phase, httpStatus: response.status, usage: null };
  evidence.push(record);
  if (Number(response.headers.get("content-length")) > 256 * 1024) return null;
  const data = await response.json().catch(() => null);
  record.usage = metricsOf(data);
  if (record.usage) {
    const { input, cachedInput, output, webCalls } = record.usage;
    const longContext = input > 272000;
    const inputCost = ((input - cachedInput) * 0.10 + cachedInput * 0.01) * (longContext ? 2 : 1);
    record.costMicroUsd = Math.ceil(inputCost + output * (longContext ? 0.75 : 0.50) + webCalls * 10000);
  }
  record.requestId = response.headers.get("x-request-id") || null;
  record.error = safeProviderCode(data?.error?.code);
  record.errorType = safeProviderCode(data?.error?.type);
  if (!response.ok) {
    const detail = String(data?.error?.message || "");
    if (/insufficient.quota|billing|credit balance|exceeded your current quota/i.test(detail)) record.problem = "quota_or_billing";
    else if (/rate limit|requests per min|tokens per min/i.test(detail)) record.problem = "rate_limit";
    else if (/missing scopes?|insufficient permissions?/i.test(detail)) {
      record.problem = "missing_scope";
      record.responsesWriteMentioned = /api\.responses\.write/.test(detail);
    } else if (/(organization|project).*(mismatch|not a member|no access|does not match)/i.test(detail)) {
      record.problem = "project_or_organization_mismatch";
    } else if (/incorrect API key|invalid API key|expired API key/i.test(detail)) record.problem = "key_rejected";
    record.rate = Object.fromEntries(["retry-after", "x-ratelimit-remaining-requests", "x-ratelimit-remaining-tokens",
      "x-ratelimit-reset-requests", "x-ratelimit-reset-tokens"].flatMap(name => {
      const val = response.headers.get(name);
      return val && /^[0-9.a-z]{1,30}$/i.test(val) ? [[name, val]] : [];
    }));
  }
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
  let charged = 0;
  const persist = status => env.DB.prepare("UPDATE web_search_v2_live_evaluation SET status = ?, evidence_json = ? WHERE id = ?")
    .bind(status, JSON.stringify({ stopped, chargedMicroUsd: charged, budgetMicroUsd: BUDGET_MICRO_USD, results, evidence }), id).run();
  try {
    const onlyCase = Number(env.BOR_LUNA_ONLY_CASE || 0);
    if (env.BOR_LUNA_ONLY_CASE || env.BOR_LUNA_RESUME_ID) {
      if (!Number.isInteger(onlyCase) || onlyCase < 1 || onlyCase > SCENARIOS.length ||
          !/^web-v2-[a-z0-9-]{8,60}$/.test(env.BOR_LUNA_RESUME_ID || "") || env.BOR_LUNA_RESUME_ID === id) {
        stopped = "invalid_resume"; await persist("stopped"); return;
      }
      const previous = await env.DB.prepare("SELECT status, evidence_json FROM web_search_v2_live_evaluation WHERE id = ?")
        .bind(env.BOR_LUNA_RESUME_ID).first();
      const paid = previous?.status === "completed" ? JSON.parse(previous.evidence_json)?.chargedMicroUsd : null;
      if (!Number.isInteger(paid) || paid < 0 || paid > BUDGET_MICRO_USD) {
        stopped = "previous_budget_unverified"; await persist("stopped"); return;
      }
      charged = paid;
      evidence.push({ phase: "resume", previousChargesMicroUsd: paid, case: onlyCase });
    }
    const expectedSuffix = env.BOR_LUNA_EXPECTED_KEY_SUFFIX;
    if (expectedSuffix) {
      const keyMatches = /^[A-Za-z0-9_-]{4}$/.test(expectedSuffix) && env.BOR_TEXT_BACKUP_API_KEY.endsWith(expectedSuffix);
      evidence.push({ phase: "key_identity", dashboardSuffixMatches: keyMatches });
      if (!keyMatches) { stopped = "staging_key_mismatch"; await persist("stopped"); return; }
    }
    const routingHeaders = {
      ...(env.BOR_LUNA_OPENAI_ORG ? { "OpenAI-Organization": env.BOR_LUNA_OPENAI_ORG } : {}),
      ...(env.BOR_LUNA_OPENAI_PROJECT ? { "OpenAI-Project": env.BOR_LUNA_OPENAI_PROJECT } : {})
    };
    if (env.BOR_LUNA_VERIFY_MODEL === "true") {
      const metadataResponse = await fetcher("https://api.openai.com/v1/models/" + MODEL, {
        method: "GET", redirect: "manual", signal: AbortSignal.timeout(12000),
        headers: { ...routingHeaders, Authorization: "Bearer " + env.BOR_TEXT_BACKUP_API_KEY }
      });
      await capture(metadataResponse, "model_access", evidence);
      if (!metadataResponse.ok) { stopped = "model_access_unverified"; await persist("stopped"); return; }
    }
    for (const [index, prompt] of SCENARIOS.entries()) {
      if (onlyCase && index + 1 !== onlyCase) continue;
      if (charged + RESERVATION_PER_ROUTER > BUDGET_MICRO_USD) { stopped = "budget_limit"; break; }
      const history = index === SCENARIOS.length - 1 ? [{ role: "user", content: SCENARIOS[1] }] : [];
      const ai = { async run(_model, payload) {
        const response = await fetcher(OPENAI, {
          method: "POST", redirect: "manual", signal: AbortSignal.timeout(12000),
          headers: { ...routingHeaders, "Content-Type": "application/json", Authorization: "Bearer " + env.BOR_TEXT_BACKUP_API_KEY },
          body: JSON.stringify({ model: MODEL, input: payload.messages, service_tier: "default", store: false, reasoning: { effort: "none" }, max_output_tokens: 220 })
        });
        const data = await capture(response, "router", evidence);
        const text = data?.output?.flatMap(item => item.type === "message" ? item.content : [])
          .find(item => item?.type === "output_text")?.text;
        return { response: response.ok ? text || "" : "" };
      } };
      const plan = await planWebSearch(ai, prompt, history);
      const row = { scenario: index + 1, automaticSearch: Boolean(plan), plan: plan || null };
      results.push(row);
      const router = evidence.at(-1);
      if (router?.phase !== "router" || router.httpStatus !== 200 || router.costMicroUsd === undefined) { stopped = "router_unverified"; break; }
      charged += router.costMicroUsd;
      if (!plan) { row.outcome = "router_declined"; await persist("running"); continue; }
      if (charged + RESERVATION_PER_SEARCH > BUDGET_MICRO_USD) { stopped = "budget_limit"; break; }
      let attempted = false;
      let admitted = false;
      const reservedDay = new Date().toISOString().slice(0, 10);
      const answer = await runWebSearchV2({
        DB: env.DB,
        BOR_WEB_SEARCH_MODE: "v2",
        BOR_WEB_SEARCH_OPENAI_KEY: env.BOR_TEXT_BACKUP_API_KEY,
        BOR_WEB_SEARCH_DAILY_CALLS: String(SCENARIOS.length + (onlyCase ? 3 : 0)),
        BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: String(RESERVATION_PER_SEARCH),
        BOR_WEB_SEARCH_DAILY_MICRO_USD: String(BUDGET_MICRO_USD),
        BOR_WEB_SEARCH_MONTHLY_MICRO_USD: String(BUDGET_MICRO_USD),
        async WEB_SEARCH_V2_FETCHER(url, options) {
          if (attempted || url !== OPENAI) throw Error("staging_attempt_limit");
          attempted = true;
          const payload = JSON.parse(options.body);
          payload.max_tool_calls = MAX_SEARCH_TOOL_CALLS;
          payload.max_output_tokens = 2000;
          payload.service_tier = "default";
          payload.reasoning = { effort: "low" };
          const response = await fetcher(url, { ...options, headers: { ...options.headers, ...routingHeaders }, signal: AbortSignal.timeout(40000), body: JSON.stringify(payload) });
          await capture(response.clone(), "search", evidence);
          return response;
        }
      }, plan, { singleOpenAiAttempt: true, onSearch() { admitted = true; } });
      row.answer = answer?.text || null;
      row.sources = answer?.links || [];
      row.corroborated = answer?.corroborated || false;
      const search = evidence.at(-1);
      if (!admitted || !attempted) { stopped = "search_admission_denied"; break; }
      if (search?.phase !== "search" || search.httpStatus !== 200 || search.costMicroUsd === undefined) { stopped = "search_unverified"; break; }
      charged += search.costMicroUsd;
      await env.DB.prepare("UPDATE web_search_v2_usage SET reserved_micro_usd = MAX(1, reserved_micro_usd - ? + ?) WHERE day = ?")
        .bind(RESERVATION_PER_SEARCH, search.costMicroUsd, reservedDay).run();
      row.outcome = answer ? "cited_answer" : "cited_answer_unavailable";
      await persist("running");
    }
  } catch {
    stopped = "staging_evaluation_error";
  }
  await persist(stopped ? "stopped" : "completed");
}
