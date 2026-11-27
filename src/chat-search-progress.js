const encoder = new TextEncoder();

// Opt-in transport. Clients that expect JSON keep the existing HTTP status and body.
export function streamChatSearch(request, handle) {
  const disconnected = new AbortController();
  const signal = AbortSignal.any([request.signal, disconnected.signal]);
  const body = new ReadableStream({
    start(controller) {
      const send = event => {
        if (!signal.aborted) controller.enqueue(encoder.encode(JSON.stringify(event) + "\n"));
      };
      (async () => {
        try {
          const response = await handle(new Request(request, { signal }), provider => send({ type: "searching", provider }));
          send({ type: "result", status: response.status, data: await response.json() });
        } catch {
          send({ type: "result", status: 503, data: { error: "Chat belum dapat diproses." } });
        } finally {
          if (!disconnected.signal.aborted) controller.close();
        }
      })();
    },
    cancel() { disconnected.abort(); }
  });
  return new Response(body, { headers: {
    "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store, no-transform",
    "X-Content-Type-Options": "nosniff"
  } });
}
