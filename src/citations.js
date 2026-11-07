// Deterministic citation guard: only source IDs successfully retrieved by the Worker are allowed.
export function validateCitationReferences(response, sources = []) {
  const text = String(response || "");
  if (!sources.length) return text;
  const validIds = new Set(
    sources.filter((source) => source?.ok === true)
      .map((source) => Number(source.sourceId))
      .filter((id) => Number.isSafeInteger(id) && id > 0)
  );
  let removed = 0;

  // Leave fenced and inline code untouched: numeric brackets there are often array indexes.
  const parts = text.split(/(`{3}[\s\S]*?`{3}|~~~[\s\S]*?~~~|`[^`\n]*`)/g);
  const cleaned = parts.map((part, index) => {
    if (index % 2 === 1) return part;
    // Numeric Markdown links are citations too; never let an invalid label smuggle an unverified URL through.
    let value = part.replace(/\[(\d+)\]\((https?:\/\/[^)\s]+)\)/gi, (marker, rawId) => {
      if (validIds.has(Number(rawId))) return marker;
      removed++;
      return "";
    });
    value = value.replace(/([ \t]*)\[(\d+)\](?!\s*\()/g, (marker, leadingSpace, rawId, offset, source) => {
      const bracketOffset = offset + leadingSpace.length;
      if (bracketOffset > 0 && /[\w\]]/.test(source[bracketOffset - 1])) return marker;
      if (validIds.has(Number(rawId))) return marker;
      removed++;
      const after = source.slice(offset + marker.length);
      if (/^[,.;:!?]/.test(after)) return "";
      return leadingSpace;
    });
    return value;
  }).join("");

  const notes = [];
  if (validIds.size === 0) {
    notes.push("Catatan sumber: tidak ada sumber yang berhasil diambil. Jawaban di atas tidak didukung oleh sumber eksternal yang diminta.");
  } else if (removed > 0) {
    notes.push("Catatan sumber: sitasi yang tidak cocok dengan sumber berhasil diambil telah dihapus.");
  }
  return notes.length ? cleaned.trim() + "\n\n" + notes.join("\n") : cleaned;
}
