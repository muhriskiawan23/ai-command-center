export const CSV_MAX_BYTES = 5 * 1024 * 1024;
export const CSV_MAX_ROWS = 10_000;
export const CSV_MAX_COLUMNS = 100;
export const CSV_PREVIEW_ROWS = 50;
export const CSV_CONTEXT_MAX_CHARS = 10_000;

function countDelimiter(line, delimiter) {
  let count = 0, quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') {
      if (quoted && line[i + 1] === '"') i++;
      else quoted = !quoted;
    } else if (!quoted && line[i] === delimiter) count++;
  }
  return count;
}
export function detectCsvDelimiter(text) {
  const lines = String(text).replace(/^\uFEFF/, "").split(/\r?\n/).filter(line => line.trim()).slice(0, 8);
  const candidates = [",", ";", "\t", "|"];
  let best = ",", bestScore = -1;
  for (const delimiter of candidates) {
    const counts = lines.map(line => countDelimiter(line, delimiter));
    const score = counts.reduce((sum, count) => sum + count, 0) + counts.filter(count => count > 0).length * 0.25;
    if (score > bestScore) { best = delimiter; bestScore = score; }
  }
  return best;
}
export function parseCsvRows(text, delimiter = detectCsvDelimiter(text), options = {}) {
  const maxRows = options.maxRows ?? CSV_MAX_ROWS, maxColumns = options.maxColumns ?? CSV_MAX_COLUMNS;
  const input = String(text).replace(/^\uFEFF/, "");
  const rows = [];
  let row = [], field = "", quoted = false, endedOnRow = false, columnsTruncated = false;
  for (let i = 0; i < input.length; i++) {
    const char = input[i];
    if (quoted) {
      if (char === '"' && input[i + 1] === '"') { field += '"'; i++; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"' && field.length === 0) quoted = true;
    else if (char === delimiter) { row.push(field); field = ""; endedOnRow = false; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.some(cell => cell.length) && rows.length < maxRows + 2) { if (row.length > maxColumns) columnsTruncated = true; rows.push(row.slice(0, maxColumns)); }
      row = []; endedOnRow = true;
    } else { field += char; endedOnRow = false; }
  }
  if (quoted) throw new Error("CSV memiliki tanda kutip yang tidak berpasangan.");
  if (!endedOnRow || field.length || row.length) {
    row.push(field);
    if (row.some(cell => cell.length) && rows.length < maxRows + 2) { if (row.length > maxColumns) columnsTruncated = true; rows.push(row.slice(0, maxColumns)); }
  }
  const truncated = rows.length > maxRows + 1;
  return { rows: rows.slice(0, maxRows + 1), truncated, columnsTruncated, delimiter };
}
function safeCell(value) {
  return String(value ?? "").replace(/\|/g, "\\|").replace(/[\r\n]+/g, " ").trim();
}
function parseNumber(value, delimiter) {
  const raw = String(value ?? "").trim().replace(/[ \u00a0]/g, "");
  if (!raw) return null;
  let normalized = raw;
  if (delimiter !== "," && /^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(raw)) normalized = raw.replace(/\./g, "").replace(",", ".");
  else if (delimiter !== "," && /^-?\d+,\d+$/.test(raw)) normalized = raw.replace(",", ".");
  else if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(raw)) normalized = raw.replace(/,/g, "");
  if (!/^-?\d+(\.\d+)?$/.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}
function summarizeColumns(headers, dataRows, delimiter) {
  return headers.map((header, column) => {
    const values = dataRows.map(row => row[column] ?? "").filter(value => String(value).trim() !== "");
    const numbers = values.map(value => parseNumber(value, delimiter)).filter(value => value !== null);
    if (!values.length || numbers.length !== values.length) return null;
    const sum = numbers.reduce((total, value) => total + value, 0);
    if (!Number.isFinite(sum)) return null;
    return { header, count: numbers.length, sum, average: sum / numbers.length, min: Math.min(...numbers), max: Math.max(...numbers) };
  }).filter(Boolean);
}
export function parseCsvText(text, options = {}) {
  const parsed = parseCsvRows(text, options.delimiter, options);
  if (!parsed.rows.length) throw new Error("CSV tidak memiliki baris data.");
  const [rawHeaders, ...dataRows] = parsed.rows;
  const seen = new Map();
  const headers = rawHeaders.slice(0, CSV_MAX_COLUMNS).map((value, index) => {
    const base = String(value || "").trim().slice(0, 120) || "Kolom " + (index + 1);
    const count = (seen.get(base) || 0) + 1; seen.set(base, count);
    return count === 1 ? base : base + " (" + count + ")";
  });
  const stats = summarizeColumns(headers, dataRows, parsed.delimiter);
  const preview = dataRows.slice(0, options.previewRows ?? CSV_PREVIEW_ROWS);
  const delimiterLabel = parsed.delimiter === "\t" ? "tab" : parsed.delimiter === ";" ? "titik koma" : parsed.delimiter === "|" ? "pipa" : "koma";
  const lines = [
    "CSV: " + String(options.name || "spreadsheet.csv").replace(/[\r\n]/g, " ").slice(0, 120),
    "Pemisah kolom: " + delimiterLabel,
    "Jumlah baris data yang diproses: " + dataRows.length + (parsed.truncated ? " (dibatasi; file memiliki baris tambahan)" : ""),
    "Jumlah kolom: " + headers.length,
    "Nama kolom: " + headers.join(" | "),
    "",
    "Ringkasan numerik deterministik (hanya kolom yang seluruh nilai terisinya berhasil dibaca sebagai angka):"
  ];
  if (stats.length) for (const item of stats) lines.push("- " + item.header + ": n=" + item.count + ", jumlah=" + item.sum + ", rata-rata=" + item.average + ", minimum=" + item.min + ", maksimum=" + item.max);
  else lines.push("- Tidak ada kolom numerik yang dapat diringkas secara konsisten.");
  lines.push("", "Pratinjau baris awal (nilai sel diperlakukan sebagai teks):", "| " + headers.map(safeCell).join(" | ") + " |", "| " + headers.map(() => "---").join(" | ") + " |");
  for (const row of preview) lines.push("| " + headers.map((_, index) => safeCell(row[index])).join(" | ") + " |");
  if (dataRows.length > preview.length || parsed.truncated || parsed.columnsTruncated) lines.push("", "CATATAN: Pratinjau menampilkan " + preview.length + " dari " + dataRows.length + " baris yang diproses. Dataset dapat memiliki baris/kolom tambahan yang tidak diproses; ringkasan numerik hanya mencakup data yang diproses.");
  let content = lines.join("\n");
  const maxChars = options.maxChars ?? CSV_CONTEXT_MAX_CHARS;
  const contentTruncated = content.length > maxChars;
  if (contentTruncated) content = content.slice(0, maxChars - 45) + "\n[Konten CSV dipotong untuk batas konteks.]";
  return { name: String(options.name || "spreadsheet.csv").slice(0, 120), content, rowCount: dataRows.length, columnCount: headers.length, truncated: parsed.truncated || parsed.columnsTruncated || dataRows.length > preview.length || contentTruncated, delimiter: parsed.delimiter };
}
export async function parseCsvLocally(file, options = {}) {
  if (!file || typeof file.text !== "function" || typeof file.size !== "number") throw new Error("File CSV tidak dapat dibaca.");
  if (file.size > CSV_MAX_BYTES) throw new Error("Ukuran CSV maksimal 5 MB.");
  if (file.size < 1) throw new Error("File CSV kosong.");
  return parseCsvText(await file.text(), { ...options, name: file.name || "spreadsheet.csv" });
}
