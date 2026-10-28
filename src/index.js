
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
      "Identify the user's objective, constraints, relevant facts, assumptions, and practical opportunities. For business requests, consider the user's budget, skills, target customers, and realistic ways to create value. For plans, identify concrete actions, resources, and measurable outputs. Never invent statistics, sources, or research. Never pretend to browse the internet. Clearly identify uncertainty. Return concise findings in the user's language. Do not write the final answer."
  },
  analyst: {
    name: "Analyst",
    prompt:
      "Analyze the original request and research findings. Recommend the most practical approach. Identify priorities, trade-offs, dependencies, obstacles, and mitigations. Respect the user's constraints. For time-based plans, give each period a distinct purpose, concrete tasks, and measurable outcomes. Avoid vague recommendations and repetition. Distinguish assumptions from facts. Match the user's language. Do not write the final answer."
  },
  writer: {
    name: "Writer",
    prompt:
      "Write the final answer that directly fulfills the original request. Use previous findings as supporting material, not text to copy. Follow the requested format and language. Respect every user constraint. Make advice practical and specific. For plans, provide concrete actions, deliverables, realistic targets, and relevant risks. Do not promise outcomes that cannot be guaranteed. Avoid generic advice, repetition, empty motivation, and irrelevant sections. Never claim to have browsed the web or performed actions that did not happen. Use readable Markdown. Finish the answer completely."
  },
  fact_checker: {
    name: "Fact Checker",
    prompt:
      "Review the research and analysis for contradictions, unsupported claims, unrealistic targets, missing caveats, and logical errors. Check whether the proposed approach directly answers the original request and respects all user constraints. Flag generic or repetitive recommendations and suggest concrete corrections. Do not claim independent external verification. Be concise and match the user's language."
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

  const result = await env.AI.run(MODEL, {
    messages,
    max_tokens: tokenLimits[agentId] || 700
  });

  const response =
    result?.response ??
    result?.result?.response ??
    "";

  if (typeof response !== "string" || !response.trim()) {
    throw new Error(`${agent.name} returned an empty response.`);
  }

  return response.trim();
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
      "Analyze these findings against the user's exact request.",
      "Identify the best practical approach, priorities, and measurable results."
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
        "Check feasibility, logical consistency, user constraints,",
        "unsupported claims, and unrealistic targets."
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
    "MANDATORY FINAL RESPONSE RULES:",
    "1. Fulfill the original request directly.",
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
