// Deterministic citation guard: only source IDs successfully fetched by the Worker are allowed.
export function validateCitationReferences(response, links = []) {
  const text = String(response || "");
  if (!links.length) return text;

  const validIds = new Set(
    links
      .filter((link) => link?.ok === true)
      .map((link) => Number(link.sourceId))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );
  let removed = 0;

  // Leave fenced and inline code untouched: numeric brackets there are often array indexes.
  const parts = text.split(/(\`\`\`[\s\S]*?\`\`\`|~~~[\s\S]*?~~~|\`[^\`\n]*\`)/g);
  const cleaned = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    return part.replace(/([ \t]*)\[(\d+)\](?!\s*\()/g, (marker, leadingSpace, rawId, offset, source) => {
      const bracketOffset = offset + leadingSpace.length;
      if (bracketOffset > 0 && /[\w\]]/.test(source[bracketOffset - 1])) return marker;
      if (validIds.has(Number(rawId))) return marker;
      removed++;
      const after = source.slice(offset + marker.length);
      if (/^[,.;:!?]/.test(after)) return "";
      return leadingSpace;
    });
  }).join("");

  const notes = [];
  if (validIds.size === 0) {
    notes.push("Catatan sumber: tidak ada tautan yang berhasil dibaca. Jawaban di atas tidak bersumber dari halaman yang diminta.");
  } else if (removed > 0) {
    notes.push("Catatan sumber: sitasi yang tidak cocok dengan sumber berhasil dibaca telah dihapus.");
  }
  return notes.length ? cleaned.trim() + "\n\n" + notes.join("\n") : cleaned;
}
