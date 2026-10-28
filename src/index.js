
const AGENTS = {
  coordinator: {
    name: "Coordinator",
    prompt:
      "You are the Coordinator of a multi-agent AI system. Coordinate the work and deliver the most useful final answer. Match the user's language. Be concise but sufficiently detailed. Avoid repetition, generic filler, and unnecessary introductions."
  },
  researcher: {
    name: "Researcher",
    prompt:
      "Identify relevant facts, assumptions, constraints, and missing information. Use supplied information and general knowledge. Never pretend to browse the internet or invent sources. Return concise findings. Match the user's language."
  },
  analyst: {
    name: "Analyst",
    prompt:
      "Analyze the request and research findings. Identify options, trade-offs, risks, and practical conclusions. Separate facts from assumptions. Avoid repeating the research. Match the user's language."
  },
  writer: {
    name: "Writer",
    prompt:
      "Write the final answer in the user's language. Be clear, practical, and direct. For simple questions, answer briefly. For complex requests, provide enough detail to be actionable without being verbose. Use headings and bullet points when useful. Avoid repetition and generic filler. Normally aim for 250-500 words for complex requests, but use fewer when sufficient. Finish every answer completely. Use normal Markdown, never escape Markdown formatting characters unnecessarily."
  },
  fact_checker: {
    name: "Fact Checker",
    prompt:
      "Check the supplied findings for contradictions, unsupported claims, missing caveats, and logical errors. Do not claim to independently verify external facts. Report only important issues. Be concise and match the user's language."
  },
  strategist: {
    name: "Strategist",
    prompt:
      "Develop practical strategies with clear priorities, trade-offs, and risks. Focus on valuable actions. Avoid generic advice and repetition. Match the user's language."
  },
  coder: {
    name: "Coder",
    prompt:
      "Act as a senior software engineer. Provide correct, secure, maintainable solutions. Explain important implementation details concisely and provide complete code when requested. Match the user's language."
  },
  planner: {
    name: "Planner",
    prompt:
      "Break the user's goal into prioritized, realistic steps with dependencies and measurable outcomes. Avoid unnecessary tasks. Match the user's language."
  },
  critic: {
    name: "Critic",
    prompt:
      "Identify important weaknesses, edge cases, risks, and improvements. Prioritize actionable feedback. Match the user's language."
  },
  summarizer: {
    name: "Summarizer",
    prompt:
      "Summarize information accurately. Preserve key points and caveats while removing repetition and unnecessary detail. Match the user's language."
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
        ? `Original request:\n${userMessage}\n\nPrevious findings:\n${context}\n\nComplete your assigned task. Be accurate, concise, and avoid repetition.`
        : userMessage
    }
  ];

  const tokenLimits = {
    researcher: 450,
    analyst: 550,
    fact_checker: 300,
    writer: 1200
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

  // Step 1: Research
  const research = await runAgent(env, "researcher", message);
  steps.push({
    agent: AGENTS.researcher.name,
    status: "completed",
    output: research
  });

  // Step 2: Analysis
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

  // Step 3: Fact-check only when useful
  // Simple requests can skip this step to reduce latency.
  const needsFactCheck =
    message.length > 500 ||
    /\b(analisis|analisa|risiko|investasi|keuangan|finansial|hukum|medis|kesehatan|bandingkan|evaluasi|strategi|fakta|data|penelitian|kode|security|keamanan)\b/i.test(message);

  let review = "Fact-check dilewati untuk menjaga respons tetap cepat.";
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

  // Step 4: Final answer
  const finalResponse = await runAgent(
    env,
    "writer",
    message,
    `Research findings:\n${research}\n\nAnalysis:\n${analysis}\n\nFact-check review:\n${review}\n\nWrite the final answer. Address important issues raised by the review. Avoid repetition. Use readable Markdown. Be complete but concise, and do not end mid-sentence.`
  );

  steps.push({
    agent: AGENTS.writer.name,
    status: "completed",
    output: finalResponse
  });

  return {
    agent: "Coordinator",
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
