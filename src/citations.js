// Deterministic citation guard: the model may cite only source IDs that the Worker actually read.
export function validateCitationReferences(response, links = []) {
  const text = String(response || "");
  if (!links.length) return text;

  const validIds = new Set(
    links.filter((link) => link?.ok === true).map((link) => Number(link.sourceId)).filter(Number.isInteger)
  );
  let removed = 0;
  const cleaned = text.replace(/\[(\d{1,3})\](?!\s*\()/g, (marker, rawId) => {
    if (validIds.has(Number(rawId))) return marker;
    removed++;
    return "";
  }).replace(/[ \t]{2,}/g, " ").replace(/[ \t]+([,.;:!?])/g, "$1");

  const notes = [];
  if (validIds.size === 0) {
    notes.push("Catatan sumber: tidak ada tautan yang berhasil dibaca. Jawaban di atas tidak bersumber dari halaman yang diminta.");
  } else if (removed > 0) {
    notes.push("Catatan sumber: sitasi yang tidak cocok dengan sumber berhasil dibaca telah dihapus.");
  }
  return notes.length ? `${cleaned.trim()}\n\n${notes.join("\n")}` : cleaned;
}
