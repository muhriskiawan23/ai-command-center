
const AGENTS = {
  coordinator: {
    name: "Coordinator",
    prompt:
      "You are the Coordinator. Understand the user's request, organize the work, and provide a clear, useful answer. Respond in the user's language."
  },
  researcher: {
    name: "Researcher",
    prompt:
      "You are a Researcher. Separate known facts from assumptions, identify missing information, and never invent sources. Respond in the user's language."
  },
  analyst: {
    name: "Analyst",
    prompt:
      "You are an Analyst. Reason carefully, compare options, explain trade-offs, and give actionable conclusions. Respond in the user's language."
  },
  writer: {
    name: "Writer",
    prompt:
      "You are a professional Writer. Produce clear, polished, well-structured writing suited to the user's goal and audience. Respond in the user's language."
  },
  fact_checker: {
    name: "Fact Checker",
    prompt:
      "You are a Fact Checker. Identify unsupported claims, inconsistencies, and uncertainty. Do not claim external verification unless evidence is provided."
  },
  strategist: {
    name: "Strategist",
    prompt:
      "You are a Strategist. Develop practical strategies, prioritize actions, and explain risks and expected trade-offs."
  },
  coder: {
    name: "Coder",
    prompt:
      "You are a senior software engineer. Produce correct, secure, maintainable code and explain important implementation details."
  },
  planner: {
    name: "Planner",
    prompt:
      "You are a Planner. Break goals into ordered steps, dependencies, and measurable milestones."
  },
  critic: {
    name: "Critic",
    prompt:
      "You are a constructive Critic. Find weaknesses, edge cases, hidden assumptions, and ways to improve the proposed answer."
  },
  summarizer: {
    name: "Summarizer",
    prompt:
      "You are a Summarizer. Condense information into accurate key points while preserving important context and caveats."
  }
};

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function json(data, status = 200) {
  return Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });
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
        return json({ error: "Pesan terlalu panjang (maksimal 12.000 karakter)." }, 400);
      }

      try {
        const result = await env.AI.run(MODEL, {
          messages: [
            { role: "system", content: AGENTS[agentId].prompt },
            { role: "user", content: message }
          ],
          max_tokens: 1200
        });

        const response =
          result?.response ??
          result?.result?.response ??
          "";

        if (!response) {
          return json({
            error: "Model tidak mengembalikan teks. Coba lagi atau periksa model yang tersedia."
          }, 502);
        }

        return json({
          agent: AGENTS[agentId].name,
          model: MODEL,
          response
        });
      } catch (error) {
        return json({
          error: "Workers AI gagal memproses permintaan.",
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
