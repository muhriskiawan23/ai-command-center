// Deterministic citation guard: only successfully retrieved source IDs and their exact URLs are allowed.
export function validateCitationReferences(response, sources = []) {
  const text = String(response || "");
  if (!sources.length) return text;
  const sourceById = new Map(
    sources.filter((source) => source?.ok === true)
      .map((source) => [Number(source.sourceId), source])
      .filter(([id]) => Number.isSafeInteger(id) && id > 0)
  );
  let removed = 0;

  function matchesSourceUrl(rawTarget, source) {
    if (typeof rawTarget !== "string") return false;
    const target = rawTarget.trim();
    const parsedTarget = target.match(/^(?:<([^>]*)>|(\S+?))(?:\s+(?:"[^"]*"|'[^']*'|\([^)]*\)))?$/);
    const href = parsedTarget?.[1] || parsedTarget?.[2];
    if (!href) return false;
    try {
      const candidate = new URL(href);
      if (candidate.protocol !== "https:" && candidate.protocol !== "http:") return false;
      return [source?.url, source?.requestedUrl, source?.resolvedUrl]
        .filter((value) => typeof value === "string" && value)
        .some((value) => {
          try {
            const canonical = new URL(value);
            return (canonical.protocol === "https:" || canonical.protocol === "http:") &&
              candidate.href === canonical.href;
          } catch {
            return false;
          }
        });
    } catch {
      return false;
    }
  }

  // Leave fenced and inline code untouched: numeric brackets there are often array indexes.
  const parts = text.split(/(\`{3}[\s\S]*?\`{3}|~~~[\s\S]*?~~~|\`[^\`\n]*\`)/g);
  const cleaned = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    // A linked citation must match BOTH a successful source ID and one of that source's exact URLs.
    // This also removes javascript:, data:, relative, malformed, and mismatched destinations.
    let value = part.replace(/\[(\d+)\]\(([^)]*)\)/g, (marker, rawId, rawTarget) => {
      const source = sourceById.get(Number(rawId));
      if (source && matchesSourceUrl(rawTarget, source)) return marker;
      removed++;
      return "";
    });
    value = value.replace(/([ \t]*)\[(\d+)\](?!\s*\()/g, (marker, leadingSpace, rawId, offset, source) => {
      const bracketOffset = offset + leadingSpace.length;
      if (bracketOffset > 0 && /[\w\]]/.test(source[bracketOffset - 1])) return marker;
      if (sourceById.has(Number(rawId))) return marker;
      removed++;
      const after = source.slice(offset + marker.length);
      if (/^[,.;:!?]/.test(after)) return "";
      return leadingSpace;
    });
    return value;
  }).join("");

  const notes = [];
  if (sourceById.size === 0) {
    notes.push("Catatan sumber: tidak ada sumber yang berhasil diambil. Jawaban di atas tidak didukung oleh sumber eksternal yang diminta.");
  } else if (removed > 0) {
    notes.push("Catatan sumber: sitasi yang tidak cocok dengan sumber berhasil diambil telah dihapus.");
  }
  return notes.length ? cleaned.trim() + "\n\n" + notes.join("\n") : cleaned;
}
