
const AGENTS = {
  coordinator: {
    name: "Coordinator",
    prompt:
      "You are the Coordinator. Organize tasks, combine agent outputs, resolve conflicts carefully, and deliver a useful final answer. Respond in the user's language."
  },
  researcher: {
    name: "Researcher",
    prompt:
      "You are a Researcher. Identify relevant facts, assumptions, missing information, and useful context from the supplied request and materials. Do not invent sources or pretend to browse the internet. Respond in the user's language."
  },
  analyst: {
    name: "Analyst",
    prompt:
      "You are an Analyst. Analyze the request and supplied research. Compare options, explain trade-offs, identify risks, and derive practical conclusions. Do not treat assumptions as facts. Respond in the user's language."
  },
  writer: {
    name: "Writer",
    prompt:
      "You are a professional Writer. Turn the supplied request and agent findings into a clear, polished, actionable final answer. Preserve important caveats and do not invent evidence. Respond in the user's language."
  },
  fact_checker: {
    name: "Fact Checker",
    prompt:
      "You are a Fact Checker. Review the supplied draft and evidence for unsupported claims, contradictions, logical gaps, and uncertainty. You cannot independently verify external facts unless evidence is supplied. Clearly state what needs verification. Respond in the user's language."
  },
  strategist: {
    name: "Strategist",
    prompt:
      "You are a Strategist. Develop practical strategies, prioritize actions, and explain risks and trade-offs. Respond in the user's language."
  },
  coder: {
    name: "Coder",
    prompt:
      "You are a senior software engineer. Produce correct, secure, maintainable code and explain important implementation details. Respond in the user's language."
  },
  planner: {
    name: "Planner",
    prompt:
      "You are a Planner. Break goals into ordered steps, dependencies, and measurable milestones. Respond in the user's language."
  },
  critic: {
    name: "Critic",
    prompt:
      "You are a constructive Critic. Identify weaknesses, edge cases, hidden assumptions, and practical improvements. Respond in the user's language."
  },
  summarizer: {
    name: "Summarizer",
    prompt:
      "You are a Summarizer. Condense information into accurate key points while preserving important context and caveats. Respond in the user's language."
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
        ? `Original request:\n${userMessage}\n\nPrevious agents' findings:\n${context}\n\nPerform your assigned task using the supplied material.`
        : userMessage
    }
  ];

  const result = await env.AI.run(MODEL, {
    messages,
    max_tokens: agentId === "writer" ? 1200 : 800
  });

  const response =
    result?.response ??
    result?.result?.response ??
    "";

  if (typeof response !== "string" || !response.trim()) {
    throw new Error(`${agent.name} did not return a text response.`);
  }

  return response.trim();
}

async function runMultiAgent(env, message) {
  const steps = [];

  // 1. Researcher gathers context and separates facts from assumptions.
  const research = await runAgent(env, "researcher", message);
  steps.push({
    agent: AGENTS.researcher.name,
    status: "completed",
    output: research
  });

  // 2. Analyst works from the original request and research findings.
  const analysis = await runAgent(
    env,
    "analyst",
    message,
    `Researcher findings:\n${research}`
  );
  steps.push({
    agent: AGENTS.analyst.name,
    status: "completed",
    output: analysis
  });

  // 3. Fact Checker reviews the findings and analysis.
  const review = await runAgent(
    env,
    "fact_checker",
    message,
    `Researcher findings:\n${research}\n\nAnalyst findings:\n${analysis}`
  );
  steps.push({
    agent: AGENTS.fact_checker.name,
    status: "completed",
    output: review
  });

  // 4. Writer integrates all prior work into the final answer.
  const finalResponse = await runAgent(
    env,
    "writer",
    message,
    `Researcher findings:\n${research}\n\nAnalyst findings:\n${analysis}\n\nFact Checker review:\n${review}\n\nWrite the final answer. Correct issues identified by the Fact Checker, preserve uncertainty, and give practical recommendations.`
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
      return json({ ok: true, service: "AI Command Center" });
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
