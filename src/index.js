
const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const AGENTS = {
  coordinator: {
    name: "Coordinator",
    prompt:
      "You are the Coordinator of a multi-agent AI system. Ensure the final answer fulfills the user's actual request. Match the user's language and requested format. Prioritize useful, specific, actionable results. Respect all user constraints, especially budget, time, skill level, and available resources. Avoid repetition, generic filler, unnecessary introductions, and unsupported claims."
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
      "ROLE CONTRACT — WRITER: Synthesize the upstream work into one excellent final response; do NOT restart the task from scratch. You MUST use the Analyst's selected approach and incorporate every material correction from the Fact Checker. Research is context, Analysis is the decision, Fact Check is the required quality gate. Do not copy whole agent outputs or repeat the same idea in multiple sections. If an upstream suggestion conflicts with the user's hard constraints, omit or replace it and briefly explain the correction when useful. For zero-budget plans, no paid ads, paid tools, or business-funded giveaways; optional partnerships must be explicitly free/barter and not required. Deliver the requested artifact in the user's language with concrete actions, outputs, realistic measurable indicators, and only relevant caveats. Never invent facts or claim browsing/actions that did not happen. Use readable Markdown and finish completely."
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

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: {
      "Cache-Control": "no-store"
    }
  });
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

  if (typeof response !== "string" || countWords(cleaned).length < 20 || cleaned.length < 100 || meaningfulLines.length < 2) {
    // Keep the workflow usable even if the model repeats an empty-Markdown response.
    const safeFallbacks = {
      researcher: "Temuan utama: tujuan pengguna adalah menyusun jawaban yang praktis dan sesuai batasan yang disebutkan. Prioritaskan fakta yang tersedia, pisahkan asumsi dari fakta, dan hindari klaim yang belum diverifikasi. Rekomendasi perlu diterjemahkan menjadi langkah konkret, keluaran yang jelas, dan indikator keberhasilan yang dapat diamati.",
      analyst: "Analisis: pilih langkah yang paling mudah dijalankan terlebih dahulu. Setiap langkah harus memiliki tindakan spesifik, hasil yang bisa diperiksa, serta ukuran keberhasilan yang realistis. Hindari aktivitas yang membutuhkan biaya atau sumber daya yang tidak disebutkan pengguna, dan sesuaikan rencana berdasarkan hasil awal.",
      fact_checker: "Pemeriksaan: pastikan seluruh saran menjawab permintaan awal dan tidak melanggar batasan pengguna. Jangan menyatakan target sebagai jaminan; perlakukan target sebagai tolok ukur awal. Hapus klaim yang tidak didukung dan pastikan setiap rekomendasi bisa dilaksanakan dengan sumber daya yang tersedia.",
      writer: "Saya belum dapat menghasilkan jawaban yang cukup lengkap dari model. Coba kirim ulang permintaan ini; proses tidak akan menampilkan keluaran Markdown kosong sebagai hasil yang berhasil.",
      coordinator: "Validasi jawaban: gunakan informasi yang tersedia, tandai asumsi dengan jelas, dan pastikan rekomendasi akhir konkret serta dapat diuji."
    };
    cleaned = safeFallbacks[agentId] || "Model tidak menghasilkan isi yang cukup. Coba ulangi permintaan dengan konteks dan tujuan yang lebih spesifik.";
  }

  return cleaned;
}

function needsFactCheck(message) {
  return (
    message.length > 500 ||
    /\b(analisis|analisa|risiko|investasi|keuangan|finansial|hukum|medis|kesehatan|bandingkan|evaluasi|strategi|fakta|data|penelitian|kode|keamanan|security|bisnis|rencana|perencanaan|forecast|prediksi|trading|saham|crypto|kripto|forex)\b/i.test(
      message
    )
  );
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
    "2. Follow the user's language and requested format.",
    "3. Respect all constraints, including budget, time, and skill level.",
    "4. Give concrete steps rather than vague instructions.",
    "5. Make targets measurable and realistic; do not guarantee results.",
    "6. For a no-budget request, do not require paid ads, subscriptions,",
    "   or paid tools. Prefer genuinely free alternatives.",
    "7. For a time-based plan, give each day a distinct task and output.",
    "8. Avoid repeated tasks, filler, and unnecessary sections.",
    "9. Do not invent facts or claim to browse the web.",
    "10. Use readable Markdown when useful.",
    "11. Finish the answer completely without ending mid-sentence."
  ].join("\n");

  const finalResponse = await runAgent(
    env,
    "writer",
    message,
    finalContext
  );

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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (
      request.method === "GET" &&
      url.pathname === "/api/health"
    ) {
      return json({
        ok: true,
        service: "AI Command Center"
      });
    }

    if (
      request.method === "GET" &&
      url.pathname === "/api/agents"
    ) {
      return json({
        agents: Object.entries(AGENTS).map(([id, agent]) => ({
          id,
          name: agent.name
        }))
      });
    }

    if (
      request.method === "POST" &&
      url.pathname === "/api/chat"
    ) {
      let body;

      try {
        body = await request.json();
      } catch {
        return json({
          error: "Request JSON tidak valid."
        }, 400);
      }

      const message =
        typeof body?.message === "string"
          ? body.message.trim()
          : "";

      const agentId =
        typeof body?.agent === "string" &&
        Object.prototype.hasOwnProperty.call(AGENTS, body.agent)
          ? body.agent
          : "coordinator";

      if (!message) {
        return json({
          error: "Pesan tidak boleh kosong."
        }, 400);
      }

      if (message.length > 12000) {
        return json({
          error: "Pesan terlalu panjang (maksimal 12.000 karakter)."
        }, 400);
      }

      try {
        if (agentId === "coordinator") {
          const result = await runMultiAgent(env, message);

          return json({
            ...result,
            model: MODEL
          });
        }

        const response = await runAgent(
          env,
          agentId,
          message
        );

        return json({
          agent: AGENTS[agentId].name,
          model: MODEL,
          workflow: "single-agent",
          response
        });
      } catch (error) {
        console.error("AI request failed:", error);

        return json({
          error: "AI gagal memproses permintaan.",
          detail: String(
            error?.message || error
          ).slice(0, 500)
        }, 502);
      }
    }

    if (
      request.method === "GET" ||
      request.method === "HEAD"
    ) {
      return env.ASSETS.fetch(request);
    }

    return json({
      error: "Endpoint tidak ditemukan."
    }, 404);
  }
};
