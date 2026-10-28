
const AGENTS = {
  coordinator: {
    name: "Coordinator",
    prompt:
      "You coordinate a multi-agent AI system. Ensure the final answer directly fulfills the user's actual request. Match the user's language and requested format. Prioritize specific, actionable results. Eliminate repetition, filler, generic advice, and irrelevant sections. Never call a new plan a revision unless requested."
  },
  researcher: {
    name: "Researcher",
    prompt:
      "Identify the user's objective, constraints, relevant facts, assumptions, and practical opportunities. For plans, identify concrete actions, required resources, and measurable targets. Never invent facts, statistics, or sources. Never pretend to browse the internet. Return concise findings in the user's language. Do not write the final answer."
  },
  analyst: {
    name: "Analyst",
    prompt:
      "Analyze the research against the exact user request. Identify the best practical approach, priorities, trade-offs, dependencies, obstacles, and mitigation. For time-based plans, assign distinct actions and measurable outcomes to each period. Replace vague suggestions with specific tasks. Avoid repeating research. Match the user's language. Do not write the final answer."
  },
  writer: {
    name: "Writer",
    prompt:
      "Write the final answer that directly fulfills the original request. Use research and analysis as supporting material, not text to copy. Follow the requested format. For plans, provide specific actions, tangible deliverables, realistic measurable targets, and relevant risks. Avoid generic advice, repetition, empty motivation, and claims of work not performed. Do not mention internal agent steps unless asked. Use readable Markdown. Be complete but concise. Never describe a new plan as a revision unless requested."
  },
  fact_checker: {
    name: "Fact Checker",
    prompt:
      "Check for contradictions, unsupported claims, unrealistic targets, missing caveats, and logical errors. Check whether the proposed approach answers the original request. Flag generic or repetitive recommendations and suggest corrections. Do not claim independent external verification. Return important findings concisely in the user's language."
  },
  strategist: {
    name: "Strategist",
    prompt:
      "Develop practical strategies with clear priorities, concrete actions, measurable outcomes, trade-offs, and risks. Respect the user's stated resources and constraints. Avoid generic advice and repetition. Match the user's language."
  },
  coder: {
    name: "Coder",
    prompt:
      "Act as a senior software engineer. Provide correct, secure, maintainable solutions. Diagnose the actual problem before recommending changes. When code is requested, provide complete usable code and identify where it belongs. Avoid unrelated changes. Match the user's language."
  },
  planner: {
    name: "Planner",
    prompt:
      "Turn the user's goal into a prioritized, realistic action plan. Each step must state what to do and what concrete result to produce. Include measurable targets, dependencies, and risks where relevant. Respect the user's resources. Avoid vague advice. Match the user's language."
  },
  critic: {
    name: "Critic",
    prompt:
      "Identify the most important weaknesses, edge cases, risks, and improvements. Prioritize actionable feedback. Challenge vague assumptions and unrealistic targets. Avoid repeating the original content. Match the user's language."
  },
  summarizer: {
    name: "Summarizer",
    prompt:
      "Summarize accurately and directly. Preserve essential facts, decisions, actions, and caveats while removing repetition and unnecessary detail. Match the user's language."
  }
};

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
}

async function runAgent(env, agentId, userMessage, context = "") {
  const agent = AGENTS[agentId];

  const messages = [
    { role: "system", content: agent.prompt },
    {
      role: "user",
      content: context
        ? `Original user request:\n${userMessage}\n\nContext from previous agents:\n${context}\n\nYour task: contribute only the findings relevant to your assigned role. Do not repeat the context. Be concise, specific, and accurate.`
        : userMessage
    }
  ];

  const tokenLimits = {
    researcher: 450,
    analyst: 550,
    fact_checker: 300,
    writer: 1200,
    strategist: 700,
    planner: 700,
    coder: 1200,
    critic: 500,
    summarizer: 500
  };

  const result = await env.AI.run(MODEL, {
    messages,
    max_tokens: tokenLimits[agentId] || 700
  });

  const response = result?.response ?? result?.result?.response ?? "";

  if (typeof response !== "string" || !response.trim()) {
    throw new Error(`${agent.name} did not return a text response.`);
  }

  return response.trim();
}

async function runMultiAgent(env, message) {
  const steps = [];

  const research = await runAgent(env, "researcher", message);
  steps.push({
    agent: AGENTS.researcher.name,
    status: "completed",
    output: research
  });

  const analysis = await runAgent(
    env,
    "analyst",
    message,
    `Research findings:\n${research}`
  );
  steps.push({
    agent: AGENTS.analyst.name,
    status: "completed",
    output: analysis
  });

  const needsFactCheck =
    message.length > 500 ||
    /\b(analisis|analisa|risiko|investasi|keuangan|finansial|hukum|medis|kesehatan|bandingkan|evaluasi|strategi|fakta|data|penelitian|kode|security|keamanan)\b/i.test(message);

  let review = "No separate fact-check was needed for this request.";

  if (needsFactCheck) {
    review = await runAgent(
      env,
      "fact_checker",
      message,
      `Research findings:\n${research}\n\nAnalysis:\n${analysis}`
    );

    steps.push({
      agent: AGENTS.fact_checker.name,
      status: "completed",
      output: review
    });
  }

  const finalContext = [
    "RESEARCH FINDINGS:",
    research,
    "",
    "ANALYSIS AND RECOMMENDED APPROACH:",
    analysis,
    "",
    "FACT-CHECK REVIEW:",
    review,
    "",
    "FINAL RESPONSE REQUIREMENTS:",
    "- Answer the original request directly.",
    "- Follow the requested output format.",
    "- For plans, give concrete tasks, deliverables, realistic targets, and risks where relevant.",
    "- Make each step distinct; avoid repeating the same advice.",
    "- Do not add generic sections just to make the answer longer.",
    "- Do not claim to have browsed the web.",
    "- Use clear Markdown headings and lists when useful.",
    "- Complete the answer without cutting off mid-sentence."
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
    agentsUsed: steps.map(step => step.agent),
    steps,
    response: finalResponse
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/api/health") {
      return json({
        ok: true,
        service: "AI Command Center"
      });
    }

    if (request.method === "GET" && url.pathname === "/api/agents") {
      return json({
        agents: Object.entries(AGENTS).map(([id, agent]) => ({
          id,
          name: agent.name
        }))
      });
    }

    if (request.method === "POST" && url.pathname === "/api/chat") {
      let body;

      try {
        body = await request.json();
      } catch {
        return json({ error: "Request JSON tidak valid." }, 400);
      }

      const message =
        typeof body.message === "string" ? body.message.trim() : "";

      const agentId =
        typeof body.agent === "string" && AGENTS[body.agent]
          ? body.agent
          : "coordinator";

      if (!message) {
        return json({ error: "Pesan tidak boleh kosong." }, 400);
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

        const response = await runAgent(env, agentId, message);

        return json({
          agent: AGENTS[agentId].name,
          model: MODEL,
          workflow: "single-agent",
          response
        });
      } catch (error) {
        return json({
          error: "AI gagal memproses permintaan.",
          detail: String(error?.message || error).slice(0, 500)
        }, 502);
      }
    }

    if (request.method === "GET" || request.method === "HEAD") {
      return env.ASSETS.fetch(request);
    }

    return json({ error: "Endpoint tidak ditemukan." }, 404);
  }
};
