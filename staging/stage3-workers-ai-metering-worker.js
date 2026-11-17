const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";
const attemptId = "stage3-workers-ai-metering-01";

function json(body, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname === "/ready" && request.method === "GET") {
      return json({ ready: true });
    }
    if (pathname !== "/probe" || request.method !== "POST") return json({ error: "unavailable" }, 404);
    const key = request.headers.get("X-BOR-Metering-Key");
    if (!/^[a-f0-9]{64}$/.test(key ?? "") || !/^[a-f0-9]{64}$/.test(env.METERING_KEY ?? "")) {
      return json({ error: "authentication_required" }, 401);
    }
    let difference = 0;
    for (let index = 0; index < 64; index++) difference |= key.charCodeAt(index) ^ env.METERING_KEY.charCodeAt(index);
    if (difference !== 0) return json({ error: "authentication_required" }, 401);
    try {
      // This sandbox marker is durable across Worker instances and deploys.
      const claim = await env.STAGE3_DB.prepare(
        "INSERT INTO stage3_staging_requests (id) VALUES (?) ON CONFLICT(id) DO NOTHING RETURNING id"
      ).bind(attemptId).first();
      if (!claim) return json({ error: "already_attempted" }, 409);
    } catch {
      return json({ error: "claim_failed" }, 503);
    }
    const startedAt = new Date().toISOString();
    let response;
    try {
      response = await env.AI.run(model, {
        messages: [{ role: "user", content: "Reply with only the word OK." }],
        max_tokens: 16,
        stream: false
      });
    } catch {
      return json({ error: "provider_request_failed", startedAt, model }, 502);
    }
    const usage = response?.usage;
    const counters = Object.fromEntries([
      "prompt_tokens", "completion_tokens", "total_tokens", "input_tokens", "output_tokens"
    ].flatMap(name => Number.isSafeInteger(usage?.[name]) && usage[name] >= 0 ? [[name, usage[name]]] : []));
    return json({ model, startedAt, usagePresent: Boolean(usage), counters });
  }
};
