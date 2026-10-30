
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const MAX_REQUEST_BYTES = 64 * 1024;

const AGENTS = {
  coordinator: {
    name: "Coordinator",
    prompt:
      "You are BOR AI's Coordinator. Fulfill the user's actual request directly, in their language and requested format. Prioritize accurate, relevant, specific, actionable answers. Follow the requested number of points and requested length; do not add an unrequested conclusion or repeat the answer. Use consistently sequential Markdown numbering (1., 2., 3., ...), never restart numbering or mix numbered-list styles. Treat user-provided facts as context, not proof of external claims. Never invent sources, browsing, tool use, calculations, or actions. If information is missing or uncertain, say so and distinguish facts, assumptions, and estimates. For calculations, show enough work to make the result auditable. Respect every explicit constraint, especially budget, time, skill level, and available resources. Avoid repetition, generic filler, and unsupported certainty."
  },
  researcher: {
    name: "Researcher",
    prompt:
      "ROLE CONTRACT — RESEARCHER: Produce an evidence-and-context brief, NOT a solution or action plan. Extract the user's objective, explicit constraints, known facts, unknowns/assumptions, target audience, available resources, and relevant opportunities. Do not prescribe a full strategy, schedule, or final answer; those belong to Analyst and Writer. Never invent statistics, sources, or research and never pretend to browse. Clearly label uncertainty. Output only these sections when relevant: Objective & constraints; Known facts vs assumptions; Relevant findings/opportunities; Questions or risks that affect the decision. Keep findings distinct and concise, in the user's language. Every bullet must contain meaningful content."
  },
  analyst: {
    name: "Analyst",
    prompt:
      "ROLE CONTRACT — ANALYST: Use the original request and Researcher's brief to make decisions, not repeat findings or draft the final deliverable. Rank the best options and explain why; identify trade-offs, dependencies, feasibility, success metrics, and what to avoid. Explicitly test the plan against every hard constraint (especially a stated zero budget). Separate must-do actions from optional experiments. For plans, define a distinct purpose and measurable output for each period. Output: Recommended approach; Priorities and rationale; Feasibility/risks; Metrics or decision rules. Refer to research findings instead of paraphrasing them. Match the user's language and make each point concrete."
  },
  writer: {
    name: "Writer",
    prompt:
      "ROLE CONTRACT — WRITER: Synthesize the upstream work into one excellent final response; do NOT restart the task from scratch. You MUST use the Analyst's selected approach and incorporate every material correction from the Fact Checker. Research is context, Analysis is the decision, Fact Check is the required quality gate. Do not copy whole agent outputs or repeat the same idea in multiple sections. If an upstream suggestion conflicts with the user's hard constraints, omit or replace it and briefly explain the correction when useful. For a strict zero-budget request, never recommend prizes, vouchers, discounts, merchandise, free food, or paid incentives unless the user explicitly confirms they are costless or donated. Do not rely on influencer participation. Treat every material Fact Checker issue as a blocking correction: remove or replace the flagged recommendation in the final answer. Deliver the requested artifact in the user's language with concrete actions, outputs, realistic measurable indicators, and only relevant caveats. Match the requested scope exactly: if the user asks for three points, provide exactly three numbered points and no extra summary/conclusion unless requested. Number lists sequentially using 1., 2., 3. consistently. Do not present context-dependent metrics as universal standards; explain briefly when a measure depends on the use case. Never invent facts or claim browsing/actions that did not happen. Use readable Markdown and finish completely."
  },
  fact_checker: {
    name: "Fact Checker",
    prompt:
      "ROLE CONTRACT — FACT CHECKER / RED TEAM: Audit the Researcher's findings and Analyst's proposed approach against the original request. Do not rewrite the plan and do not merely say it looks good. Look specifically for constraint violations, hidden costs, unsupported factual claims, unrealistic metrics, missing prerequisites, contradictions, and recommendations that do not logically follow. For each material issue, state: Issue; Why it matters; Required correction. Example: a 'Rp0 budget' giveaway that requires the business to pay for a voucher is NOT free unless the prize is donated or costless. Distinguish definite errors from risks/assumptions; do not claim external verification. If no material issue exists, state that explicitly and name what you checked. Match the user's language; prioritize actionable corrections."
  },
  strategist: {
    name: "Strategist",
    prompt:
      "Develop practical strategies with clear priorities, concrete actions, measurable outcomes, trade-offs, and risks. Tailor the strategy to the user's stated resources, budget, and capabilities. Prefer low-cost experiments and realistic validation before scaling. Avoid generic advice and repetition. Match the user's language."
  },
  coder: {
    name: "Coder",
    prompt:
      "Act as a senior software engineer. Provide correct, secure, maintainable solutions. Diagnose the actual problem before recommending changes. Respect the user's existing architecture and avoid breaking working functionality. When code is requested, provide complete usable code and clearly explain where it belongs. Match the user's language."
  },
  planner: {
    name: "Planner",
    prompt:
      "Turn the user's goal into a prioritized, realistic action plan. Each step must specify what to do, how to do it, and what concrete result to produce. Include measurable targets, dependencies, and risks where relevant. Respect the user's resources and constraints. Avoid unnecessary tasks, repeated actions, and vague advice. Match the user's language."
  },
  critic: {
    name: "Critic",
    prompt:
      "Identify the most important weaknesses, edge cases, risks, unrealistic assumptions, and improvements. Check feasibility against the user's constraints. Prioritize actionable feedback. Avoid repeating the original content. Match the user's language."
  },
  summarizer: {
    name: "Summarizer",
    prompt:
      "Summarize accurately and directly. Preserve essential facts, decisions, actions, and caveats while removing repetition and unnecessary detail. Match the user's language."
  }
};

function json(data, status = 200, extraHeaders = {}) {
  const headers = new Headers({
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff"
  });
  for (const [name, value] of Object.entries(extraHeaders)) {
    if (name.toLowerCase() === "set-cookie" && Array.isArray(value)) {
      for (const cookie of value) headers.append(name, cookie);
    } else {
      headers.set(name, value);
    }
  }
  return Response.json(data, { status, headers });
}

async function serveAsset(request, env) {
  const response = await env.ASSETS.fetch(request);
  const headers = new Headers(response.headers);
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  headers.set("Permissions-Policy", "camera=(), microphone=(), geolocation=()");

  if (/^text\/html(?:;|$)/i.test(headers.get("Content-Type") || "")) {
    headers.set(
      "Content-Security-Policy",
      "default-src 'self'; base-uri 'self'; object-src 'none'; frame-ancestors 'none'; form-action 'self'; connect-src 'self' https://accounts.google.com; script-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/client; style-src 'self' 'unsafe-inline' https://accounts.google.com/gsi/style; img-src 'self' data: https:; frame-src https://accounts.google.com/gsi/; upgrade-insecure-requests"
    );
  }

  return new Response(request.method === "HEAD" ? null : response.body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

async function readBodyWithinLimit(request, maxBytes) {
  if (!request.body) return { text: "", tooLarge: false };

  const reader = request.body.getReader();
  const chunks = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;

      if (totalBytes > maxBytes) {
        await reader.cancel();
        return { tooLarge: true };
      }

      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      tooLarge: false
    };
  } catch {
    return { invalidEncoding: true, tooLarge: false };
  }
}

async function runAgent(env, agentId, userMessage, context = "") {
  const agent = AGENTS[agentId];

  if (!agent) {
    throw new Error(`Unknown agent: ${agentId}`);
  }

  const messages = [
    {
      role: "system",
      content: agent.prompt
    },
    {
      role: "user",
      content: context
        ? [
            "ORIGINAL USER REQUEST:",
            userMessage,
            "",
            "CONTEXT AND PREVIOUS FINDINGS:",
            context,
            "",
            "YOUR ASSIGNED TASK:",
            "Contribute only what is relevant to your role.",
            "Do not repeat the context unnecessarily.",
            "Be specific, accurate, and concise.",
            "Respect the original user's constraints."
          ].join("\n")
        : userMessage
    }
  ];

  const tokenLimits = {
    researcher: 500,
    analyst: 600,
    fact_checker: 350,
    writer: 1400,
    strategist: 800,
    coder: 1400,
    planner: 800,
    critic: 500,
    summarizer: 500,
    coordinator: 700
  };

  const cleanOutput = (value) => String(value || "").trim().split("\n").filter((line) => {
    const trimmed = line.trim();
    if (/^#{1,6}\s*$/.test(trimmed)) return false;
    if (/^[-*+]\s*$/.test(trimmed)) return false;
    return true;
  }).join("\n").trim();

  const generate = (extraInstruction = "") => env.AI.run(MODEL, {
    messages: extraInstruction
      ? [...messages, { role: "user", content: extraInstruction }]
      : messages,
    max_tokens: tokenLimits[agentId] || 700,
    temperature: 0.4,
    repetition_penalty: 1.1
  });

  let result = await generate();
  let response = result?.response ?? result?.result?.response ?? "";
  let cleaned = cleanOutput(response);
  const countWords = (value) => value.replace(/[#*_\`>~-]/g, " ").match(/[\p{L}\p{N}]{2,}/gu) || [];

  // Retry once when the model returns mostly empty Markdown markers.
  if (typeof response !== "string" || countWords(cleaned).length < 8 || cleaned.length < 35) {
    result = await generate(
      "RETRY REQUIRED: Your previous answer contained empty Markdown headings or bullets and was unusable. Return substantive content in plain text or simple numbered points. Do not output empty headings, empty bullets, or Markdown-only lines. Include at least 3 concrete findings when appropriate. Every bullet must contain a complete sentence. Answer in the user's language."
    );
    response = result?.response ?? result?.result?.response ?? "";
    cleaned = cleanOutput(response);
  }

  // Reject responses that contain lots of Markdown structure but little actual content.
  const meaningfulLines = cleaned.split("\n").filter((line) => {
    const text = line.trim().replace(/^#{1,6}\s*/, "").replace(/^[-*+>\d.)\s]+/, "").replace(/[\*_\x60]/g, "").trim();
    return text.length >= 12 && countWords(text).length >= 3;
  });

  if (typeof response !== "string" || (agentId === "coordinator" && !cleaned) || (agentId !== "coordinator" && (countWords(cleaned).length < 20 || cleaned.length < 100 || meaningfulLines.length < 2))) {
    // Do not mark a generic placeholder as a successful agent result.
    // Let the request boundary return a sanitized error after the retry fails.
    throw new Error(`Agent ${agentId} returned unusable output after retry`);
  }

  return cleaned;
}

// Use a single model call for straightforward requests; reserve orchestration for complex tasks.
function shouldUseMultiAgent(message) {
  const complexIntent = /\b(analisis|analisa|bandingkan|evaluasi|strategi|rencana|perencanaan|penelitian|risiko|debug|refactor|arsitektur|forecast|prediksi|proposal|roadmap|audit|business plan|coding|kode)\b/i;
  const zeroBudgetPromotion =
    /(?:rp\s*0|modal\s*(?:sebesar\s*)?0|tanpa\s+(?:modal|biaya)|zero[- ]budget|no[- ]budget)/i.test(message) &&
    /(?:promosi|marketing|kampanye|konten|media\s+sosial|mahasiswa|warkop|bisnis)/i.test(message);
  const explicitLongOutput = /\b(?:\d{3,}\s*(?:kata|words|halaman|pages)|(?:minimal|setidaknya|sekitar|at least|about)\s+\d{3,}\s*(?:kata|words))\b/i.test(message);
  const exactFormatRequest = requestedNumberedItemCount(message) !== null;
  return message.length > 700 || complexIntent.test(message) || needsFactCheck(message) || zeroBudgetPromotion || explicitLongOutput || exactFormatRequest;
}

function requestedNumberedItemCount(message) {
  const match = message.match(/\b(?:tepat|persis|exactly)\s+(\d{1,2})\s+(?:poin|point|points|butir|langkah|steps|items)\b/i);
  return match ? Number(match[1]) : null;
}

function hasExactlySequentialNumberedItems(response, expectedCount) {
  const lines = response.split("\n").map((line) => line.trim()).filter(Boolean);
  const numberedLines = lines.filter((line) => /^\d{1,2}[.)]\s+\S/.test(line));
  const numbers = numberedLines.map((line) => Number(line.match(/^(\d{1,2})[.)]/)[1]));

  // Exact-item requests must contain only the requested top-level numbered items.
  // Indented continuation lines and nested bullets are intentionally disallowed
  // to keep the contract unambiguous and reliably machine-checkable.
  return lines.length === expectedCount &&
    numberedLines.length === expectedCount &&
    numbers.every((number, index) => number === index + 1);
}

function needsFactCheck(message) {
  return (
    message.length > 500 ||
    /\b(analisis|analisa|risiko|investasi|keuangan|finansial|hukum|medis|kesehatan|bandingkan|evaluasi|strategi|fakta|data|penelitian|kode|keamanan|security|bisnis|rencana|perencanaan|forecast|prediksi|trading|saham|crypto|kripto|forex)\b/i.test(
      message
    )
  );
}

function isZeroBudgetPromotionRequest(message) {
  return /(?:rp\s*0|modal\s*(?:sebesar\s*)?0|tanpa\s+(?:modal|biaya)|zero[- ]budget|no[- ]budget)/i.test(message) &&
    /(?:promosi|marketing|kampanye|konten|media\s+sosial|mahasiswa|warkop|bisnis)/i.test(message);
}

function hasPaidIncentiveRecommendation(response) {
  const incentivePattern = /\b(?:voucher|giveaway|merchandise|diskon|potongan\s+harga|cashback|cash\s+back|hadiah|prize|doorprize|gratis\s+makan|makan\s+gratis|free\s+meal|free\s+gift|paid\s+ads|iklan\s+berbayar|boost(?:ed)?\s+post|paid\s+influencer|influencer\s+berbayar|paid\s+kol|kol\s+berbayar|endorsement\s+berbayar|paid\s+endorsement|sponsor\s+berbayar|langganan\s+berbayar|tool\s+premium|software\s+berbayar|aplikasi\s+berbayar)\b/i;
  const recommendationPattern = /\b(?:berikan|memberikan|bagikan|menawarkan|tawarkan|adakan|mengadakan|buat|gunakan|memakai|jalankan|promosikan|siapkan|sediakan|belikan|bayar|alokasikan|pasang|hire|give|offer|run|use|launch|sponsor|provide|recommend)\b/i;
  const negationPattern = /\b(?:jangan|hindari|tanpa|tidak|bukan|dilarang|do\s+not|don't|avoid|never|not)\b/i;
  const clauses = String(response).split(/(?<=[.!?;])\s+|,\s+|\n/i);

  return clauses.some((clause) => {
    if (!incentivePattern.test(clause) || !recommendationPattern.test(clause)) return false;
    const index = clause.search(incentivePattern);
    const context = clause.slice(Math.max(0, index - 42), Math.min(clause.length, index + 65));
    return !negationPattern.test(context);
  });
}

async function runMultiAgent(env, message) {
  const steps = [];

  // Step 1: Researcher identifies the goal and constraints.
  const research = await runAgent(
    env,
    "researcher",
    message
  );

  steps.push({
    agent: AGENTS.researcher.name,
    status: "completed",
    output: research
  });

  // Step 2: Analyst develops a practical approach.
  const analysis = await runAgent(
    env,
    "analyst",
    message,
    [
      "Research findings:",
      research,
      "",
      "Treat the research as input, not a draft to rewrite.",
      "Do not repeat the Researcher's findings.",
      "Choose and rank a practical approach, explain trade-offs, and define measurable results."
    ].join("\n")
  );

  steps.push({
    agent: AGENTS.analyst.name,
    status: "completed",
    output: analysis
  });

  // Step 3: Fact-check important or complex requests.
  let review = "Skipped for this request.";

  if (needsFactCheck(message)) {
    review = await runAgent(
      env,
      "fact_checker",
      message,
      [
        "Research findings:",
        research,
        "",
        "Analysis:",
        analysis,
        "",
        "Audit the proposed approach against the original request and all hard constraints.",
        "Actively search for hidden costs, unsupported claims, unrealistic targets, and logical gaps.",
        "For each issue, provide the correction the Writer must apply.",
        "Do not rubber-stamp the plan or rewrite it wholesale."
      ].join("\n")
    );

    steps.push({
      agent: AGENTS.fact_checker.name,
      status: "completed",
      output: review
    });
  }

  // Step 4: Writer produces the final user-facing response.
  const finalContext = [
    "RESEARCH FINDINGS:",
    research,
    "",
    "ANALYSIS AND RECOMMENDATIONS:",
    analysis,
    "",
    "FACT-CHECK REVIEW:",
    review,
    "",
    "MANDATORY SYNTHESIS AND QUALITY GATE:",
    "1. Use the Analyst's chosen approach as the backbone; do not start over.",
    "2. Apply every material Fact Checker correction. Do not include a flagged idea unchanged.",
    "3. Do not repeat the Researcher or Analyst verbatim; synthesize their distinct contributions.",
    "4. If an upstream recommendation violates a hard constraint, replace it with a feasible alternative.",
    "5. Fulfill the original request directly.",
    "6. Follow the user's language and requested format.",
    "7. Respect all constraints, including budget, time, and skill level.",
    "8. Give concrete steps rather than vague instructions.",
    "9. Make targets measurable and realistic; do not guarantee results.",
    "10. For a no-budget request, do not require paid ads, subscriptions,",
    "    or paid tools. Prefer genuinely free alternatives.",
    "11. For a time-based plan, give each day a distinct task and output.",
    "12. Avoid repeated tasks, filler, and unnecessary sections.",
    "13. Do not invent facts or claim to browse the web.",
    "14. Use readable Markdown when useful.",
    "15. Finish the answer completely without ending mid-sentence.",
    "16. Match the requested number of points exactly; do not add an unrequested conclusion or repeat the key points.",
    "17. Number ordered lists sequentially with one consistent Markdown format (1., 2., 3., ...).",
    "18. Qualify context-dependent metrics and avoid presenting illustrative examples as universal requirements."
  ].join("\n");

  let finalResponse = await runAgent(
    env,
    "writer",
    message,
    finalContext
  );

  // Deterministic repair pass for a common hard-constraint failure:
  // a zero-budget promotion plan that sneaks in business-funded incentives.
  const zeroBudgetPromotion = isZeroBudgetPromotionRequest(message);
  if (zeroBudgetPromotion && hasPaidIncentiveRecommendation(finalResponse)) {
    const draftToRepair = finalResponse;
    finalResponse = await runAgent(
      env,
      "writer",
      message,
      [
        finalContext,
        "",
        "BLOCKING QUALITY-GATE REPAIR",
        "The previous draft violated the user's strict zero-budget constraint.",
        "Rewrite the full answer. Remove every prize, voucher, giveaway, merchandise, discount, free food, paid influencer, or paid advertising recommendation unless the user explicitly confirmed it is donated and costs the business nothing.",
        "Use only actions that require no spending, such as organic posts, story polls, menu votes, customer feedback with consent, and tracking baseline metrics.",
        "Do not merely disclaim the costs. Replace the ideas with feasible zero-cost alternatives.",
        "",
        "DRAFT TO REPAIR:",
        draftToRepair
      ].join("\n")
    );
    if (hasPaidIncentiveRecommendation(finalResponse)) {
      throw new Error("Writer failed zero-budget quality gate");
    }
  }

  const requestedCount = requestedNumberedItemCount(message);
  if (requestedCount !== null && !hasExactlySequentialNumberedItems(finalResponse, requestedCount)) {
    finalResponse = await runAgent(
      env,
      "writer",
      message,
      [
        finalContext,
        "",
        "MANDATORY FORMAT REPAIR",
        `The user explicitly requested exactly ${requestedCount} numbered items.`,
        `Rewrite the complete answer with exactly ${requestedCount} numbered items, numbered sequentially from 1 to ${requestedCount}.`,
        "Do not add an introduction, conclusion, or extra numbered items outside that list."
      ].join("\n")
    );
  }

  // A repair attempt is not a pass: fail closed if the final answer still violates
  // an explicit format contract instead of returning a knowingly invalid response.
  if (requestedCount !== null && !hasExactlySequentialNumberedItems(finalResponse, requestedCount)) {
    throw new Error("Writer failed exact numbered-item quality gate");
  }

  steps.push({
    agent: AGENTS.writer.name,
    status: "completed",
    output: finalResponse
  });

  return {
    agent: AGENTS.coordinator.name,
    workflow: "multi-agent",
    agentsUsed: steps.map((step) => step.agent),
    steps,
    response: finalResponse
  };
}


const SESSION_COOKIE = "__Host-borai_session";
const OAUTH_NONCE_COOKIE = "__Host-borai_oauth_nonce";
const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
const encoder = new TextEncoder();
let googleJwksCache = null;
let googleJwksExpiresAt = 0;

function readCookie(request, name) {
  for (const part of (request.headers.get("Cookie") || "").split(";")) {
    const index = part.indexOf("=");
    if (index >= 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return "";
}
function base64UrlBytes(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - normalized.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}
function base64UrlJson(value) {
  return JSON.parse(new TextDecoder().decode(base64UrlBytes(value)));
}
function randomToken(byteLength = 32) {
  const bytes = crypto.getRandomValues(new Uint8Array(byteLength));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function sha256Hex(value) {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
function cookieHeader(name, value, maxAge) {
  return name + "=" + value + "; Path=/; Max-Age=" + maxAge + "; Secure; HttpOnly; SameSite=Lax";
}
function sameOrigin(request) {
  const origin = request.headers.get("Origin");
  return Boolean(origin) && origin === new URL(request.url).origin;
}
async function verifyGoogleCredential(credential, nonce, env) {
  if (!env.GOOGLE_CLIENT_ID || typeof credential !== "string" || typeof nonce !== "string") throw new Error("Google sign-in is not configured.");
  const parts = credential.split(".");
  if (parts.length !== 3 || parts.some((part) => !part)) throw new Error("Invalid identity token.");
  const header = base64UrlJson(parts[0]);
  const claims = base64UrlJson(parts[1]);
  if (header.alg !== "RS256" || typeof header.kid !== "string") throw new Error("Unsupported identity token.");
  if (!googleJwksCache || Date.now() >= googleJwksExpiresAt) {
    const response = await fetch("https://www.googleapis.com/oauth2/v3/certs", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Google signing keys are unavailable.");
    googleJwksCache = await response.json();
    const maxAge = Number((response.headers.get("Cache-Control") || "").match(/max-age=(\d+)/i)?.[1] || 300);
    googleJwksExpiresAt = Date.now() + Math.max(60, Math.min(maxAge, 3600)) * 1000;
  }
  const jwk = googleJwksCache.keys?.find((key) => key.kid === header.kid && key.kty === "RSA");
  if (!jwk) { googleJwksExpiresAt = 0; throw new Error("Unknown Google signing key."); }
  const publicKey = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const validSignature = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", publicKey, base64UrlBytes(parts[2]), encoder.encode(parts[0] + "." + parts[1]));
  if (!validSignature) throw new Error("Invalid identity token signature.");
  const now = Math.floor(Date.now() / 1000);
  const audience = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!audience.includes(env.GOOGLE_CLIENT_ID) ||
      !["accounts.google.com", "https://accounts.google.com"].includes(claims.iss) ||
      !Number.isFinite(claims.exp) || claims.exp <= now ||
      !Number.isFinite(claims.iat) || claims.iat > now + 60 ||
      claims.nonce !== nonce ||
      typeof claims.sub !== "string" || !claims.sub ||
      typeof claims.email !== "string" || claims.email_verified !== true) {
    throw new Error("Google identity token claims are invalid.");
  }
  return claims;
}
async function getSession(request, env) {
  const token = readCookie(request, SESSION_COOKIE);
  if (!token) return null;
  if (!env.DB) throw new Error("Database is not configured.");
  const tokenHash = await sha256Hex(token);
  return env.DB.prepare(
    "SELECT users.id, users.email, users.name, users.picture FROM sessions " +
    "JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?"
  ).bind(tokenHash, Math.floor(Date.now() / 1000)).first();
}
function authRequiredResponse() {
  return json({ error: "Silakan masuk dengan akun Google untuk mengakses riwayat chat." }, 401);
}
async function readJsonRequest(request, maxBytes = 16 * 1024) {
  if (!/^\s*application\/json(?:\s*;|\s*$)/i.test(request.headers.get("Content-Type") || "")) return { error: json({ error: "Content-Type harus application/json." }, 415) };
  const contentLength = Number(request.headers.get("Content-Length") || 0);
  if (Number.isFinite(contentLength) && contentLength > maxBytes) return { error: json({ error: "Ukuran request terlalu besar." }, 413) };
  let bodyResult;
  try { bodyResult = await readBodyWithinLimit(request, maxBytes); }
  catch { return { error: json({ error: "Request body tidak dapat dibaca." }, 400) }; }
  if (bodyResult.tooLarge) return { error: json({ error: "Ukuran request terlalu besar." }, 413) };
  if (bodyResult.invalidEncoding) return { error: json({ error: "Request JSON tidak valid." }, 400) };
  try { return { body: JSON.parse(bodyResult.text) }; }
  catch { return { error: json({ error: "Request JSON tidak valid." }, 400) }; }
}
async function handleAuthRoute(request, env, url) {
  if (url.pathname === "/api/config" && request.method === "GET") {
    return json({ googleClientId: env.GOOGLE_CLIENT_ID || null, googleSignInEnabled: Boolean(env.GOOGLE_CLIENT_ID && env.DB) });
  }
  if (url.pathname === "/api/auth/nonce" && request.method === "GET") {
    if (!env.DB || !env.GOOGLE_CLIENT_ID) return json({ error: "Login Google belum dikonfigurasi." }, 503);
    const nonce = randomToken();
    return json({ nonce }, 200, { "Set-Cookie": cookieHeader(OAUTH_NONCE_COOKIE, nonce, 300) });
  }
  if (url.pathname === "/api/auth/google" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Origin tidak valid." }, 403);
    if (!env.DB || !env.GOOGLE_CLIENT_ID) return json({ error: "Login Google belum dikonfigurasi." }, 503);
    const parsed = await readJsonRequest(request);
    if (parsed.error) return parsed.error;
    const nonceCookie = readCookie(request, OAUTH_NONCE_COOKIE);
    const nonce = parsed.body?.nonce;
    if (!nonceCookie || typeof nonce !== "string" || nonce !== nonceCookie) {
      return json({ error: "Sesi login kedaluwarsa. Silakan coba masuk kembali." }, 403, { "Set-Cookie": cookieHeader(OAUTH_NONCE_COOKIE, "", 0) });
    }
    try {
      const claims = await verifyGoogleCredential(parsed.body?.credential, nonce, env);
      const now = Math.floor(Date.now() / 1000);
      const user = await env.DB.prepare(
        "INSERT INTO users (id, email, name, picture, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
        "ON CONFLICT(id) DO UPDATE SET email=excluded.email, name=excluded.name, picture=excluded.picture, updated_at=excluded.updated_at RETURNING id"
      ).bind(claims.sub, claims.email, String(claims.name || "").slice(0, 160), String(claims.picture || "").slice(0, 1000), now, now).first();
      if (!user?.id) throw new Error("Unable to create user.");
      const sessionToken = randomToken();
      await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)")
        .bind(await sha256Hex(sessionToken), user.id, now + SESSION_TTL_SECONDS, now).run();
      return json({
        authenticated: true,
        user: { id: user.id, email: claims.email, name: claims.name || "", picture: claims.picture || "" }
      }, 200, { "Set-Cookie": [
        cookieHeader(SESSION_COOKIE, sessionToken, SESSION_TTL_SECONDS),
        cookieHeader(OAUTH_NONCE_COOKIE, "", 0)
      ] });
    } catch (error) {
      console.error("Google authentication failed:", error);
      return json({ error: "Google sign-in gagal diverifikasi. Silakan coba lagi." }, 401, { "Set-Cookie": cookieHeader(OAUTH_NONCE_COOKIE, "", 0) });
    }
  }
  if (url.pathname === "/api/auth/me" && request.method === "GET") {
    try {
      if (!readCookie(request, SESSION_COOKIE)) return json({ authenticated: false });
      const user = await getSession(request, env);
      if (!user) return json({ authenticated: false }, 200, { "Set-Cookie": cookieHeader(SESSION_COOKIE, "", 0) });
      return json({ authenticated: true, user });
    } catch (error) {
      console.error("Session lookup failed:", error);
      return json({ error: "Status login sementara tidak dapat diperiksa." }, 503);
    }
  }
  if (url.pathname === "/api/auth/logout" && request.method === "POST") {
    if (!sameOrigin(request)) return json({ error: "Origin tidak valid." }, 403);
    try {
      const token = readCookie(request, SESSION_COOKIE);
      if (token && env.DB) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha256Hex(token)).run();
      return json({ authenticated: false }, 200, { "Set-Cookie": cookieHeader(SESSION_COOKIE, "", 0) });
    } catch (error) {
      console.error("Logout failed:", error);
      return json({ error: "Tidak dapat mengakhiri sesi saat ini." }, 503);
    }
  }
  return null;
}
async function handleConversationRoute(request, env, url) {
  if (url.pathname !== "/api/conversations" && !url.pathname.startsWith("/api/conversations/")) return null;
  if (request.method === "DELETE" && !sameOrigin(request)) return json({ error: "Origin tidak valid." }, 403);
  let user;
  try { user = await getSession(request, env); }
  catch (error) { console.error("Conversation session lookup failed:", error); return json({ error: "Penyimpanan riwayat belum tersedia." }, 503); }
  if (!user) return authRequiredResponse();
  if (!env.DB) return json({ error: "Penyimpanan riwayat belum tersedia." }, 503);
  if (url.pathname === "/api/conversations" && request.method === "GET") {
    const result = await env.DB.prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100").bind(user.id).all();
    return json({ conversations: result.results || [] });
  }
  if (url.pathname === "/api/conversations" && request.method === "DELETE") {
    await env.DB.prepare("DELETE FROM conversations WHERE user_id = ?").bind(user.id).run();
    return json({ deleted: true });
  }
  const conversationId = url.pathname.slice("/api/conversations/".length);
  if (!/^[a-zA-Z0-9-]{8,80}$/.test(conversationId)) return json({ error: "Chat tidak ditemukan." }, 404);
  if (request.method === "GET") {
    const conversation = await env.DB.prepare("SELECT id, title, created_at, updated_at FROM conversations WHERE id = ? AND user_id = ?").bind(conversationId, user.id).first();
    if (!conversation) return json({ error: "Chat tidak ditemukan." }, 404);
    const result = await env.DB.prepare("SELECT role, content, created_at FROM messages WHERE conversation_id = ? AND user_id = ? ORDER BY id ASC").bind(conversationId, user.id).all();
    return json({ conversation, messages: result.results || [] });
  }
  if (request.method === "DELETE") {
    const result = await env.DB.prepare("DELETE FROM conversations WHERE id = ? AND user_id = ?").bind(conversationId, user.id).run();
    if (!result.meta?.changes) return json({ error: "Chat tidak ditemukan." }, 404);
    return json({ deleted: true, id: conversationId });
  }
  return json({ error: "Metode HTTP tidak didukung untuk endpoint ini." }, 405, { Allow: "GET, DELETE" });
}
async function persistConversation(env, user, conversationId, message, response) {
  const now = Math.floor(Date.now() / 1000);
  const id = conversationId || crypto.randomUUID();
  const title = message.replace(/\s+/g, " ").slice(0, 72) || "Percakapan baru";
  const statements = [];
  if (!conversationId) {
    statements.push(env.DB.prepare("INSERT INTO conversations (id, user_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)")
      .bind(id, user.id, title, now, now));
  } else {
    statements.push(env.DB.prepare("UPDATE conversations SET updated_at = ? WHERE id = ? AND user_id = ?").bind(now, id, user.id));
  }
  statements.push(env.DB.prepare("INSERT INTO messages (conversation_id, user_id, role, content, created_at) VALUES (?, ?, 'user', ?, ?)").bind(id, user.id, message, now));
  statements.push(env.DB.prepare("INSERT INTO messages (conversation_id, user_id, role, content, created_at) VALUES (?, ?, 'assistant', ?, ?)").bind(id, user.id, response, now));
  await env.DB.batch(statements);
  return id;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname.startsWith("/api/auth/") || url.pathname === "/api/config") {
      const response = await handleAuthRoute(request, env, url);
      if (response) return response;
    }
    if (url.pathname === "/api/conversations" || url.pathname.startsWith("/api/conversations/")) {
      if (!["GET", "DELETE"].includes(request.method)) return json({ error: "Metode HTTP tidak didukung untuk endpoint ini." }, 405, { Allow: "GET, DELETE" });
      try { return await handleConversationRoute(request, env, url); }
      catch (error) { console.error("Conversation request failed:", error); return json({ error: "Riwayat chat gagal diproses." }, 503); }
    }
    if (request.method === "GET" && url.pathname === "/api/health") return json({ ok: true, service: "BOR AI" });
    if (request.method === "GET" && url.pathname === "/api/agents") {
      return json({ agents: Object.entries(AGENTS).map(([id, agent]) => ({ id, name: agent.name })) });
    }
    if (request.method === "POST" && url.pathname === "/api/chat") {
      if (!/^\s*application\/json(?:\s*;|\s*$)/i.test(request.headers.get("Content-Type") || "")) return json({ error: "Content-Type harus application/json." }, 415);
      const contentLength = Number(request.headers.get("Content-Length") || 0);
      if (Number.isFinite(contentLength) && contentLength > MAX_REQUEST_BYTES) return json({ error: "Ukuran request terlalu besar." }, 413);
      let bodyResult;
      try { bodyResult = await readBodyWithinLimit(request, MAX_REQUEST_BYTES); }
      catch { return json({ error: "Request body tidak dapat dibaca." }, 400); }
      if (bodyResult.tooLarge) return json({ error: "Ukuran request terlalu besar." }, 413);
      if (bodyResult.invalidEncoding) return json({ error: "Request JSON tidak valid." }, 400);
      let body;
      try { body = JSON.parse(bodyResult.text); }
      catch { return json({ error: "Request JSON tidak valid." }, 400); }
      const message = typeof body?.message === "string" ? body.message.trim() : "";
      if (body?.agent !== undefined && (typeof body.agent !== "string" || !Object.prototype.hasOwnProperty.call(AGENTS, body.agent))) return json({ error: "Agent tidak dikenal." }, 400);
      const agentId = body?.agent || "coordinator";
      if (!message) return json({ error: "Pesan tidak boleh kosong." }, 400);
      if (message.length > 12000) return json({ error: "Pesan terlalu panjang (maksimal 12.000 karakter)." }, 400);
      if (body?.conversationId !== undefined && (typeof body.conversationId !== "string" || !/^[a-zA-Z0-9-]{8,80}$/.test(body.conversationId))) return json({ error: "ID percakapan tidak valid." }, 400);
      let user = null;
      try { user = await getSession(request, env); }
      catch (error) { console.error("Chat session lookup failed:", error); return json({ error: "Status login tidak dapat diperiksa. Coba muat ulang halaman." }, 503); }
      if (user && !sameOrigin(request)) return json({ error: "Origin tidak valid." }, 403);
      if (user && body.conversationId) {
        const owned = await env.DB.prepare("SELECT id FROM conversations WHERE id = ? AND user_id = ?").bind(body.conversationId, user.id).first();
        if (!owned) return json({ error: "Chat tidak ditemukan." }, 404);
      }
      if (env.CHAT_LIMITER?.limit) {
        let rateLimit;
        try {
          const clientKey = request.headers.get("CF-Connecting-IP") || "unknown-client";
          rateLimit = await env.CHAT_LIMITER.limit({ key: clientKey });
        } catch (error) { console.error("Chat rate limiter failed:", error); return json({ error: "Layanan pembatasan permintaan sedang bermasalah." }, 503); }
        if (!rateLimit?.success) return json({ error: "Terlalu banyak permintaan. Coba lagi dalam satu menit." }, 429, { "Retry-After": "60" });
      }
      try {
        let result;
        if (agentId === "coordinator" && shouldUseMultiAgent(message)) result = { ...await runMultiAgent(env, message), model: MODEL };
        else if (agentId === "coordinator") {
          const response = await runAgent(env, "coordinator", message);
          result = { agent: AGENTS.coordinator.name, model: MODEL, workflow: "single-agent", agentsUsed: [AGENTS.coordinator.name], response };
        } else {
          const response = await runAgent(env, agentId, message);
          result = { agent: AGENTS[agentId].name, model: MODEL, workflow: "single-agent", response };
        }
        if (user) {
          try {
            result.conversationId = await persistConversation(env, user, body.conversationId || null, message, result.response);
            result.saved = true;
          } catch (error) {
            console.error("Chat persistence failed:", error);
            result.saved = false;
            result.saveWarning = "Jawaban berhasil dibuat, tetapi riwayat gagal disimpan. Salin jawaban ini sebelum meninggalkan halaman.";
          }
        } else result.saved = false;
        return json(result);
      } catch (error) {
        console.error("AI request failed:", error);
        return json({ error: "AI gagal memproses permintaan. Silakan coba lagi beberapa saat." }, 502);
      }
    }
    if (url.pathname.startsWith("/api/") && ["/api/health", "/api/agents", "/api/chat"].includes(url.pathname)) {
      const allowed = url.pathname === "/api/chat" ? ["POST"] : ["GET"];
      if (!allowed.includes(request.method)) return json({ error: "Metode HTTP tidak didukung untuk endpoint ini." }, 405, { Allow: allowed.join(", ") });
    }
    if (url.pathname.startsWith("/api/")) return json({ error: "Endpoint tidak ditemukan." }, 404);
    if (request.method === "GET" || request.method === "HEAD") return serveAsset(request, env);
    return json({ error: "Endpoint tidak ditemukan." }, 404);
  }
};
