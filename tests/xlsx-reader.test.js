import test from "node:test";
import assert from "node:assert/strict";
import { parseXlsxWorkbook, parseXlsxLocally, XLSX_LIMITS } from "../public/xlsx-reader.js";

const utils = {
  decode_range() { return { s: { r: 0, c: 0 }, e: { r: 2, c: 1 } }; },
  encode_cell({ r, c }) { return String.fromCharCode(65 + c) + (r + 1); }
};
const workbook = {
  SheetNames: ["Sales"],
  Sheets: { Sales: { "!ref": "A1:B3", A1: { v: "Product", t: "s" }, B1: { v: "Revenue", t: "s" }, A2: { v: "Coffee", t: "s" }, B2: { v: 120000, w: "120,000", t: "n" }, A3: { v: "Tea", t: "s" }, B3: { v: 80000, w: "80,000", t: "n" } } }
};

test("parses workbook sheets and deterministic numeric summaries", () => {
  const result = parseXlsxWorkbook(workbook, utils);
  assert.equal(result.kind, "xlsx");
  assert.equal(result.sheetCount, 1);
  assert.equal(result.rowCount, 2);
  assert.match(result.content, /Coffee/);
  assert.match(result.content, /average=100,000/);
});
test("keeps formulas literal and excludes cached formula values from summaries", () => {
  const book = { SheetNames: ["Calc"], Sheets: { Calc: { "!ref": "A1:B2", A1: { v: "Item", t: "s" }, B1: { v: "Value", t: "s" }, A2: { v: "Total", t: "s" }, B2: { f: "SUM(B3:B4)", v: 99, t: "n", w: "99" } } } };
  const result = parseXlsxWorkbook(book, utils);
  assert.match(result.content, /=SUM\(B3:B4\)/);
  assert.doesNotMatch(result.content, /average=99/);
});
test("bounds sheets, rows, columns and context", () => {
  const result = parseXlsxWorkbook({ SheetNames: ["A", "B"], Sheets: { A: workbook.Sheets.Sales, B: workbook.Sheets.Sales } }, { ...utils, maxSheets: 1, maxRows: 1, maxColumns: 1 });
  assert.equal(result.sheetCount, 1);
  assert.equal(result.truncated, true);
  assert.ok(result.content.length <= XLSX_LIMITS.maxContextChars + 120);
});
test("rejects unavailable parser and oversized file before reading", async () => {
  await assert.rejects(parseXlsxLocally({ size: XLSX_LIMITS.maxBytes + 1, arrayBuffer: async () => new ArrayBuffer(0) }, { xlsx: null }), /maksimal 5 MB/);
});
