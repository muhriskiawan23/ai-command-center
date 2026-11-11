import { DurableObject } from "cloudflare:workers";

const PORT = 8080;
const INACTIVITY_TIMEOUT_MS = 120_000;

export class EgressTransportContainer extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "POST" || url.pathname !== "/run") {
      return new Response("Not found", { status: 404 });
    }

    const container = this.ctx.container;
    await container.setInactivityTimeout(INACTIVITY_TIMEOUT_MS);
    if (!container.running) {
      container.start({
        image: container.images.base,
        instance: "lite",
        enableInternet: false
      });
    }

    const port = container.getTcpPort(PORT);
    let lastError;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        const health = await port.fetch("http://container/health", {
          signal: AbortSignal.timeout(1_000)
        });
        await health.body?.cancel();
        if (health.ok) {
          return port.fetch("http://container/run", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: "{}"
          });
        }
        lastError = new Error("container_health_check_failed");
      } catch (error) {
        lastError = error;
      }
      await scheduler.wait(200);
    }
    return Response.json({
      success: false,
      error: "container_not_ready",
      detail: String(lastError?.message || "unknown").slice(0, 120)
    }, { status: 503 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("ok", { headers: { "cache-control": "no-store" } });
    }
    if (request.method !== "POST" || url.pathname !== "/run") {
      return new Response("Not found", { status: 404 });
    }
    const id = env.EGRESS_CONTAINER.idFromName("node-transport-validation");
    return env.EGRESS_CONTAINER.get(id).fetch(
      new Request("http://container/run", { method: "POST" })
    );
  }
};
