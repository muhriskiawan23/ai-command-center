// For a trusted sideband adapter. The browser never supplies search requests,
// delegation events or billing data to this module.
export function voiceSearch({ lookup, send, signal }) {
  const fragments = [];
  const attempted = new Set();
  let pending = false;
  return async function receive(event) {
    if (signal.aborted) return;
    if (event?.type === 'session.input_transcript.delta' &&
        typeof event.delta === 'string' && event.delta.length <= 4096 &&
        Number.isFinite(event.start_ms) && Number.isFinite(event.end_ms) &&
        event.start_ms >= 0 && event.end_ms >= event.start_ms) {
      fragments.push(event);
      if (fragments.length > 64) fragments.shift();
      return;
    }
    const id = event?.delegation?.id;
    const offset = event?.offset_ms;
    if (event?.type !== 'session.delegation.created' || event.delegation?.target !== 'client' ||
        typeof id !== 'string' || !/^item_[a-zA-Z0-9_-]{1,128}$/.test(id) ||
        !Number.isFinite(offset) || offset < 0 || pending || attempted.size >= 3 ||
        attempted.has(id)) return;
    const query = fragments.filter(part => part.end_ms <= offset && part.end_ms >= offset - 30000)
      .sort((a, b) => a.start_ms - b.start_ms).map(part => part.delta).join('').trim().slice(-1500);
    // Do not infer a query from an unrelated event or ask the backend with empty context.
    if (!query) return;
    attempted.add(id);
    pending = true;
    try {
      const result = await lookup(query, { signal });
      if (signal.aborted) return;
      const answer = typeof result?.answer === 'string' ? result.answer.trim().slice(0, 4000) : '';
      const sources = Array.isArray(result?.sources) ? result.sources.slice(0, 8).flatMap(source => {
        try {
          const url = new URL(source.url);
          return url.protocol === 'https:' && !url.username && !url.password && url.href.length <= 1000
            ? [url.href] : [];
        } catch { return []; }
      }) : [];
      const content = answer && sources.length ? JSON.stringify({ answer, sources }) :
        'Pencarian belum menghasilkan jawaban yang dapat diverifikasi.';
      await send({ type: 'session.commentary.append', event_id: crypto.randomUUID(), delegation_id: id, content });
    } finally {
      pending = false;
    }
  };
}
