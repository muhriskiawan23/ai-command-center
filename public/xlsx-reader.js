const MAX_XLSX_BYTES = 5 * 1024 * 1024;
const MAX_SHEETS = 5;
const MAX_ROWS = 10_000;
const MAX_COLUMNS = 100;
const MAX_CONTEXT_CHARS = 10_000;

function cleanCell(value) {
  return String(value ?? "").replace(/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/g, " ").replace(/\\s+/g, " ").trim();
}
function displayCell(cell) {
  if (!cell) return "";
  if (typeof cell.f === "string" && cell.f) return "=" + cell.f;
  if (cell.w !== undefined && cell.w !== null) return cleanCell(cell.w);
  if (cell.v instanceof Date) return cell.v.toISOString();
  return cleanCell(cell.v);
}
function numericValue(cell) {
  if (!cell || cell.f || cell.t !== "n" || typeof cell.v !== "number" || !Number.isFinite(cell.v)) return null;
  return cell.v;
}
function formatNumber(value) {
  return Number(value.toPrecision(12)).toLocaleString("en-US", { maximumFractionDigits: 6 });
}
export function parseXlsxWorkbook(workbook, options = {}) {
  if (!workbook || !Array.isArray(workbook.SheetNames) || !workbook.Sheets) throw new Error("Workbook Excel tidak valid atau tidak dapat dibaca.");
  const maxSheets = Math.max(1, Math.min(MAX_SHEETS, Number(options.maxSheets) || MAX_SHEETS));
  const maxRows = Math.max(1, Math.min(MAX_ROWS, Number(options.maxRows) || MAX_ROWS));
  const maxColumns = Math.max(1, Math.min(MAX_COLUMNS, Number(options.maxColumns) || MAX_COLUMNS));
  const names = workbook.SheetNames.slice(0, maxSheets);
  if (!names.length) throw new Error("Workbook Excel tidak memiliki sheet yang dapat dibaca.");
  const output = [], summaries = [];
  let rowCount = 0, columnCount = 0, truncated = workbook.SheetNames.length > names.length;
  for (const sheetName of names) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet || !sheet["!ref"]) continue;
    const range = options.decodeRange ? options.decodeRange(sheet["!ref"]) : null;
    if (!range) throw new Error("Rentang sheet Excel tidak dapat dibaca.");
    const availableRows = range.e.r - range.s.r + 1;
    const availableColumns = range.e.c - range.s.c + 1;
    const takeRows = Math.max(0, Math.min(availableRows, maxRows - rowCount));
    const takeColumns = Math.max(0, Math.min(availableColumns, maxColumns));
    if (takeRows < availableRows || takeColumns < availableColumns) truncated = true;
    if (!takeRows || !takeColumns) { truncated = true; break; }
    output.push("### Sheet: " + cleanCell(sheetName).slice(0, 80));
    const matrix = [];
    for (let r = 0; r < takeRows; r++) {
      const row = [];
      for (let c = 0; c < takeColumns; c++) {
        const address = options.encodeCell ? options.encodeCell({ r: range.s.r + r, c: range.s.c + c }) : null;
        if (!address) throw new Error("Alamat sel Excel tidak dapat dibaca.");
        row.push(displayCell(sheet[address]));
      }
      matrix.push(row);
    }
    const headers = (matrix[0] || []).map((value, index) => value || "Kolom " + (index + 1));
    const dataRows = matrix.slice(1);
    output.push("| " + headers.map(v => v.replace(/\\|/g, "\\|")).join(" | ") + " |");
    for (const row of dataRows) output.push("| " + row.map(v => v.replace(/\\|/g, "\\|")).join(" | ") + " |");
    const sums = [];
    for (let c = 0; c < takeColumns; c++) {
      const values = [];
      for (let r = 1; r < takeRows; r++) {
        const address = options.encodeCell({ r: range.s.r + r, c: range.s.c + c });
        const n = numericValue(sheet[address]);
        if (n !== null) values.push(n);
      }
      if (values.length) {
        const sum = values.reduce((a, b) => a + b, 0);
        if (Number.isFinite(sum)) sums.push(headers[c] + ": count=" + values.length + ", sum=" + formatNumber(sum) + ", average=" + formatNumber(sum / values.length) + ", min=" + formatNumber(Math.min(...values)) + ", max=" + formatNumber(Math.max(...values)));
      }
    }
    if (sums.length) output.push("Ringkasan numerik (sel angka, formula dikecualikan): " + sums.join("; "));
    rowCount += dataRows.length; columnCount = Math.max(columnCount, takeColumns);
    if (rowCount >= maxRows || columnCount >= maxColumns && availableColumns > takeColumns) { truncated = true; break; }
  }
  if (!output.length) throw new Error("Tidak ada data tabel yang dapat dibaca dari workbook.");
  let content = output.join("\\n");
  if (content.length > MAX_CONTEXT_CHARS) { content = content.slice(0, MAX_CONTEXT_CHARS); truncated = true; }
  if (truncated) content += "\\n\\nCATATAN: Data workbook dibatasi oleh batas sheet, baris, kolom, atau panjang konteks.";
  return { name: cleanCell(options.name || "spreadsheet.xlsx").slice(0, 120), kind: "xlsx", content, rowCount, columnCount, sheetCount: names.length, truncated };
}
export async function parseXlsxLocally(file, options = {}) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("File Excel tidak dapat dibaca.");
  if (file.size > MAX_XLSX_BYTES) throw new Error("Ukuran Excel maksimal 5 MB.");
  const xlsx = options.xlsx || globalThis.XLSX;
  if (!xlsx?.read || !xlsx?.utils?.decode_range || !xlsx?.utils?.encode_cell) throw new Error("Pustaka pembaca Excel belum tersedia. Periksa koneksi lalu muat ulang halaman.");
  let workbook;
  try {
    const buffer = await file.arrayBuffer();
    workbook = xlsx.read(buffer, { type: "array", cellFormula: true, cellText: true, cellDates: true, bookVBA: false });
  } catch {
    throw new Error("File Excel rusak, tidak didukung, atau gagal dibuka.");
  }
  return parseXlsxWorkbook(workbook, { ...xlsx.utils, name: file.name });
}
export const XLSX_LIMITS = Object.freeze({ maxBytes: MAX_XLSX_BYTES, maxSheets: MAX_SHEETS, maxRows: MAX_ROWS, maxColumns: MAX_COLUMNS, maxContextChars: MAX_CONTEXT_CHARS });
