import candidate from "./index.js";
import { AGENTS } from "./prompts.js";
import { json, sha256Hex } from "./http.js";
import { planWebSearch, runWebSearchV2, LUNA_SEARCH_RESERVATION_MICRO_USD } from "./web-search-v2.js";
import fixture from "../evaluation/answer-quality-smoke.json" with { type: "json" };

const campaign = "answer-quality-af5dd9b-v1";
const commit = "af5dd9b473576affbcc269b90b28e852d506ca82";
const endpoint = "https://api.openai.com/v1/responses";
const model = "gpt-6-luna";
const textBudget = 240_000;
const searchBudget = LUNA_SEARCH_RESERVATION_MICRO_USD;
const totalBudget = 500_000;
const maxWindow = 300_000;
const maxBodyBytes = 256 * 1024;
const maxTextInputBytes = 32_000;
// Allow core multi-agent stages, one paid inference per distinct agent per turn.
const maxTextCalls = 24;
export const MAX_BENCHMARK_D1_QUERIES = 40;
// Keep two operations available for completion and a terminal failure write.
const maxRunningD1Queries = MAX_BENCHMARK_D1_QUERIES - 2;
const textTurnCostCeilingMicroUsd = 7_500;
if (maxTextCalls * textTurnCostCeilingMicroUsd > textBudget) throw new Error("Benchmark text ceiling exceeds reservation");
const stagingHost = "bor-ai-luna-staging.muhriskiawan23.workers.dev";
const campaignRoute = "/__staging/answer-quality-benchmark";
const encoder = new TextEncoder();

const expectedCases = [
  ["compact-id", "chat", 1], ["arithmetic-id", "chat", 1], ["context-id", "chat", 2],
  ["code-en", "chat", 1], ["evidence-id", "chat", 1], ["bennu-id", "web_search", 1]
];
const cases = fixture.cases;
if (textBudget + searchBudget !== totalBudget || cases.length !== expectedCases.length ||
    cases.some((entry, i) => entry.id !== expectedCases[i][0] || entry.route !== expectedCases[i][1] ||
      entry.turns.length !== expectedCases[i][2] ||
      entry.turns.some(turn => typeof turn !== "string" || !turn.trim() || encoder.encode(turn).length > 1800))) {
  throw new Error("Invalid pinned benchmark fixture");
}

async function authorized(request, secret) {
  const header = request.headers.get("Authorization") || "";
  if (typeof secret !== "string" || secret.length < 32 || secret.length > 249 ||
      !header.startsWith("Bearer ") || header.length > 256) return false;
  const [provided, expected] = await Promise.all([sha256Hex(header.slice(7)), sha256Hex(secret)]);
  let mismatch = 0;
  for (let i = 0; i < expected.length; i++) mismatch |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  return mismatch === 0;
}

// The approval row is prepared only on the independently verified isolated staging DB.
// All benchmark routes must honor this same campaign row, including any standalone runner.
function claim(db, expiry, evidence) {
  return db.prepare(`
    UPDATE web_search_v2_live_evaluation SET status = 'running', evidence_json = ?1
    WHERE id = ?2 AND status = 'approved'
      AND CASE WHEN json_valid(evidence_json) THEN
        json_extract(evidence_json, '$.candidate') = ?3
        AND json_extract(evidence_json, '$.expiresAt') = ?4
        AND json_extract(evidence_json, '$.scope') = 'bor-ai-luna-staging'
        AND json_extract(evidence_json, '$.reservationMicroUsd') = ?5
        AND json_extract(evidence_json, '$.route') = 'integrated-staging'
      ELSE 0 END
      AND NOT EXISTS (SELECT 1 FROM web_search_v2_live_evaluation WHERE status = 'running')
    RETURNING id
  `).bind(JSON.stringify(evidence), campaign, commit, expiry, totalBudget).first();
}

function persist(db, status, evidence) {
  return db.prepare(`
    UPDATE web_search_v2_live_evaluation SET status = ?, evidence_json = ?
    WHERE id = ? AND status = 'running' RETURNING id
  `).bind(status, JSON.stringify(evidence), campaign).first();
}

export function createBenchmarkDatabase(binding) {
  let queries = 0;
  let exhausted = false;
  function wrap(statement, limit) {
    function execute(method, args) {
      if (queries >= limit) {
        exhausted = true;
        throw new Error("benchmark_d1_limit");
      }
      queries++;
      return statement[method](...args);
    }
    return {
      bind: (...args) => wrap(statement.bind(...args), limit),
      first: (...args) => execute("first", args),
      all: (...args) => execute("all", args),
      run: (...args) => execute("run", args)
    };
  }
  // The pinned guest-chat and search routes use individual statements only.
  // Do not expose unmetered methods such as batch or exec to either route.
  const scoped = limit => ({ prepare: sql => wrap(binding.prepare(sql), limit) });
  return {
    running: scoped(maxRunningD1Queries),
    terminal: scoped(MAX_BENCHMARK_D1_QUERIES),
    get exhausted() { return exhausted; }
  };
}

async function readProvider(response) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("provider_response_missing");
  let size = 0;
  let raw = "";
  const decoder = new TextDecoder();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBodyBytes) {
        await reader.cancel();
        throw new Error("provider_response_too_large");
      }
      raw += decoder.decode(value, { stream: true });
    }
    return JSON.parse(raw + decoder.decode());
  } finally {
    reader.releaseLock();
  }
}

function receipt(response, data, kind) {
  const id = response.headers.get("x-request-id");
  const usage = data?.usage;
  const input = usage?.input_tokens;
  const output = usage?.output_tokens;
  const cached = usage?.input_tokens_details?.cached_tokens ?? 0;
  const observed = Array.isArray(data?.output) ? data.output.filter(x => x?.type === "web_search_call").length : null;
  const billed = data?.tool_usage?.web_search?.num_requests;
  const validCount = count => Number.isSafeInteger(count) && count >= 0;
  if (!response.ok || data?.status !== "completed" || !/^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(data?.model || "") ||
      !/^req_[a-z0-9_-]{1,128}$/i.test(id || "") || ![input, output, cached, observed].every(validCount) ||
      cached > input || input > (kind === "search" ? 1_050_000 : 64_000) ||
      output > 2200 || observed !== (kind === "search" ? 1 : 0) ||
      (billed !== undefined && (!validCount(billed) || billed > observed))) throw new Error("unverified_provider_receipt");
  const longContext = input > 272_000;
  const estimatedMicroUsd = Math.ceil((input - cached) * (longContext ? 0.20 : 0.10) +
    cached * (longContext ? 0.02 : 0.01) + output * (longContext ? 0.75 : 0.50) +
    (billed ?? observed) * 10_000);
  return { requestId: id, model: data.model, input, output, cached, observed, billed: billed ?? null, estimatedMicroUsd };
}

function textFrom(data) {
  return data.output.flatMap(item => item?.type === "message" && Array.isArray(item.content) ? item.content : [])
    .filter(item => item?.type === "output_text" && typeof item.text === "string").map(item => item.text).join("\n");
}

function routingHeaders(env) {
  const org = env.BOR_WEB_SEARCH_OPENAI_ORG;
  const project = env.BOR_WEB_SEARCH_OPENAI_PROJECT;
  if (!/^org-[a-z0-9_-]{3,128}$/i.test(org || "") ||
      !/^proj_[a-z0-9_-]{3,128}$/i.test(project || "")) return null;
  return { "OpenAI-Organization": org, "OpenAI-Project": project };
}

function boundedTextRun(send, classifierOnly = false) {
  const attempted = new Set();
  let denied = false;
  return { get denied() { return denied; }, async run(_model, payload, { signal } = {}) {
    signal?.throwIfAborted();
    const input = payload?.messages;
    const limit = payload?.max_tokens;
    if (!Array.isArray(input) || !input.length || input.length > 12 ||
        input.some(item => !["system", "user", "assistant"].includes(item?.role) || typeof item.content !== "string") ||
        payload?.tools?.length || !Number.isSafeInteger(limit) || limit < 1 || limit > 2200) {
      denied = true;
      throw new Error("benchmark_text_request_out_of_scope");
    }
    const stage = classifierOnly ? "classifier" : Object.keys(AGENTS).find(name =>
      input[0].role === "system" && input[0].content.includes(AGENTS[name].prompt));
    if (!stage || attempted.has(stage) || attempted.size >= 4) {
      denied = true;
      throw new Error("benchmark_text_retry_denied");
    }
    attempted.add(stage);
    const data = await send({ model, input, store: false, truncation: "disabled", service_tier: "default",
      reasoning: { effort: "low" }, max_output_tokens: limit }, stage, signal);
    const response = textFrom(data);
    if (!response.trim()) throw new Error("benchmark_text_empty");
    return { response };
  } };
}

export function createAnswerQualityBenchmarkWorker(fetcher = (...args) => fetch(...args)) {
  return { async fetch(request, env) {
    const url = new URL(request.url);
    const expiry = Number(env.BOR_LUNA_ANSWER_BENCHMARK_EXPIRES_AT);
    const now = Date.now();
    if (request.method !== "POST" || url.pathname !== campaignRoute || url.search ||
        url.protocol !== "https:" || url.host !== stagingHost ||
        env.BOR_LUNA_ANSWER_BENCHMARK_ENABLED !== "true" || env.BOR_WEB_SEARCH_KILL_SWITCH !== "false" ||
        env.BOR_WEB_SEARCH_MODE !== "off" || env.BOR_LUNA_STAGING_WEB_SEARCH_ENABLED === "true" ||
        env.BOR_LUNA_STAGING_URL_READER_ENABLED === "true" || !Number.isSafeInteger(expiry) ||
        expiry <= now || expiry > now + maxWindow) return json({ error: "not_found" }, 404);
    if (!await authorized(request, env.BOR_LUNA_STAGING_TOKEN)) return json({ error: "operator_auth_required" }, 401);
    const routing = routingHeaders(env);
    const key = env.BOR_WEB_SEARCH_OPENAI_KEY;
    if (!env.DB?.prepare || !routing || typeof key !== "string" || !key.trim()) {
      return json({ error: "staging_not_configured" }, 503);
    }
    const evidence = { candidate: commit, reservationMicroUsd: totalBudget, textBudget, searchBudget,
      route: "integrated-staging", receipts: [], completedTurns: [], reconciliationRequired: true };
    const db = createBenchmarkDatabase(env.DB);
    try {
      if (!await claim(db.running, expiry, evidence)) return json({ error: "campaign_not_admitted" }, 409);
    } catch {
      return json({ error: "campaign_ledger_unavailable" }, 503);
    }
    const signal = AbortSignal.any([request.signal, AbortSignal.timeout(Math.max(1, expiry - Date.now()))]);
    const answers = [];
    let current;
    let textCalls = 0;
    let searchCalls = 0;
    let providerFailed = false;
    let journal = Promise.resolve();
    async function send(body, kind, stage = kind, upstreamSignal) {
      signal.throwIfAborted();
      upstreamSignal?.throwIfAborted();
      const serialized = JSON.stringify(body);
      if (providerFailed || db.exhausted || encoder.encode(serialized).length > maxTextInputBytes ||
          body.model !== model || body.store !== false || body.service_tier !== "default" ||
          !Number.isSafeInteger(body.max_output_tokens) || body.max_output_tokens < 1 || body.max_output_tokens > 2200 ||
          (kind === "search" ? searchCalls !== 0 : textCalls >= maxTextCalls || body.tools !== undefined)) {
        throw new Error("benchmark_provider_limit");
      }
      if (kind === "search") searchCalls++;
      else textCalls++;
      // Journal admission before dispatch. Any uncertain outcome keeps the entire reservation.
      const attempt = { turn: current, kind, stage, dispatchAdmitted: true };
      try {
        // Each write also checkpoints receipts and turns already available in memory.
        // Serialize admissions so parallel agents cannot overwrite a newer journal.
        const admission = journal.then(async () => {
          if (providerFailed || db.exhausted) throw new Error("benchmark_provider_stopped");
          signal.throwIfAborted();
          upstreamSignal?.throwIfAborted();
          evidence.receipts.push(attempt);
          if (!await persist(db.running, "running", evidence)) throw new Error("campaign_ledger_lost");
        });
        journal = admission.catch(() => { providerFailed = true; });
        await admission;
        signal.throwIfAborted();
        upstreamSignal?.throwIfAborted();
        if (providerFailed || db.exhausted) throw new Error("benchmark_provider_stopped");
        const timeout = AbortSignal.timeout(kind === "search" ? 40_000 : 20_000);
        const deadline = AbortSignal.any(upstreamSignal ? [signal, upstreamSignal, timeout] : [signal, timeout]);
        const response = await fetcher(endpoint, { method: "POST", redirect: "error", signal: deadline,
          headers: { Authorization: "Bearer " + key, "Content-Type": "application/json", ...routing }, body: serialized });
        const data = await readProvider(response);
        Object.assign(attempt, receipt(response, data, kind));
        const phaseSpend = evidence.receipts.filter(item => (item.kind === "search") === (kind === "search"))
          .reduce((sum, item) => sum + (item.estimatedMicroUsd ?? 0), 0);
        if (phaseSpend > (kind === "search" ? searchBudget : textBudget)) throw new Error("reservation_overrun");
        return data;
      } catch (error) {
        providerFailed = true;
        throw error;
      }
    }
    try {
      for (const test of cases) {
        const history = [];
        for (const [i, prompt] of test.turns.entries()) {
          current = test.id + ":" + (i + 1);
          signal.throwIfAborted();
          let answer;
          let links = [];
          const receiptCount = evidence.receipts.length;
          if (test.route === "chat") {
            const ai = boundedTextRun((body, stage, upstreamSignal) => send(body, "text", stage, upstreamSignal));
            const response = await candidate.fetch(new Request(url.origin + "/api/chat", { signal, method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ message: prompt, history, language: test.id.endsWith("-en") ? "en" : "id" }) }),
            { DB: db.running, AI: ai, BOR_WEB_SEARCH_MODE: "off", BOR_ANSWER_QUALITY_PROFILE: "enhanced" });
            const data = await response.json();
            if (ai.denied || !response.ok || data.saved || typeof data.response !== "string" || !data.response.trim()) {
              throw new Error("candidate_chat_unverified");
            }
            answer = data.response;
          } else {
            const classifier = boundedTextRun((body, stage, upstreamSignal) => send(body, "classifier", stage, upstreamSignal), true);
            const plan = await planWebSearch(classifier, prompt, history, signal);
            if (classifier.denied || !plan) throw new Error("candidate_router_unverified");
            const result = await runWebSearchV2({
              DB: db.running, BOR_WEB_SEARCH_MODE: "v2",
              BOR_WEB_SEARCH_OPENAI_KEY: key, BOR_WEB_SEARCH_OPENAI_ORG: env.BOR_WEB_SEARCH_OPENAI_ORG,
              BOR_WEB_SEARCH_OPENAI_PROJECT: env.BOR_WEB_SEARCH_OPENAI_PROJECT,
              BOR_WEB_SEARCH_DAILY_CALLS: "1", BOR_WEB_SEARCH_OPENAI_CALL_MICRO_USD: String(searchBudget),
              BOR_WEB_SEARCH_DAILY_MICRO_USD: String(totalBudget), BOR_WEB_SEARCH_MONTHLY_MICRO_USD: String(totalBudget),
              async WEB_SEARCH_V2_FETCHER(target, options) {
                const body = JSON.parse(options.body);
                if (target !== endpoint || options.method !== "POST" || body.tools?.length !== 1 ||
                    body.tools[0].type !== "web_search" || body.tool_choice?.type !== "web_search") {
                  throw new Error("benchmark_search_transport_denied");
                }
                return Response.json(await send({ ...body, max_tool_calls: 1, truncation: "disabled" }, "search", "search", options.signal));
              }
            }, plan, { signal, singleOpenAiAttempt: true });
            if (result?.provider !== "OpenAI" || result.partial || !result.text?.trim() || !result.links?.length) {
              throw new Error("candidate_search_unverified");
            }
            answer = result.text;
            links = result.links;
          }
          const receipts = evidence.receipts.slice(receiptCount);
          if (providerFailed || db.exhausted || (test.route === "chat" ? receipts.length < 1 || receipts.length > 4 : receipts.length !== 2) || receipts.some(item => !item.requestId)) {
            throw new Error("benchmark_turn_unverified");
          }
          if (test.id === "compact-id" && answer.trim() !== "323") throw new Error("compact_answer_failed");
          answers.push({ id: current, answer, links });
          history.push({ role: "user", content: prompt }, { role: "assistant", content: answer });
          evidence.completedTurns.push(current);
        }
      }
      if (!await persist(db.terminal, "completed", evidence)) throw new Error("campaign_ledger_lost");
      return json({ ok: true, campaign, answers, evidence });
    } catch {
      evidence.stoppedAt = current;
      // Do not refund, reopen, or retry a campaign with an uncertain provider outcome.
      providerFailed = true;
      await journal;
      try { await persist(db.terminal, "stopped", evidence); } catch { /* running still blocks replay */ }
      return json({ error: "benchmark_stopped", campaign, answers, evidence }, 502);
    }
  } };
}

export default createAnswerQualityBenchmarkWorker();
