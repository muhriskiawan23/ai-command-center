import test from "node:test";
import assert from "node:assert/strict";
import { parseXlsxArrayBuffer, parseXlsxLocally, XLSX_MAX_BYTES } from "../public/xlsx-reader.js";

function fakeXlsx(withFormula = false) {
  const sheet = {
    "!ref": "A1:B3",
    A1: { v: "Produk" }, B1: { v: "Pendapatan" },
    A2: { v: "Kopi" }, B2: { v: 120 },
    A3: { v: "Teh" }, B3: withFormula ? { v: 80, f: "40+40" } : { v: 80 }
  };
  const second = { "!ref": "A1:A2", A1: { v: "Catatan" }, A2: { v: "OK" } };
  return {
    read: () => ({ SheetNames: ["Penjualan", "Catatan"], Sheets: { Penjualan: sheet, Catatan: second } }),
    utils: {
      decode_range: () => ({ s: { r: 0, c: 0 }, e: { r: 2, c: 1 } }),
      encode_cell: ({ r, c }) => String.fromCharCode(65 + c) + (r + 1),
      sheet_to_json: (ws) => [[ws.A1?.v ?? "", ws.B1?.v ?? ""], [ws.A2?.v ?? "", ws.B2?.v ?? ""], [ws.A3?.v ?? "", ws.B3?.v ?? ""]]
    }
  };
}

test("reads multiple workbook sheets and computes deterministic numeric summaries", () => {
  const result = parseXlsxArrayBuffer(new ArrayBuffer(8), { name: "sales.xlsx", xlsx: fakeXlsx() });
  assert.equal(result.sheetCount, 2);
  assert.equal(result.rowCount, 4);
  assert.equal(result.name, "sales.xlsx");
  assert.match(result.content, /Sheet: Penjualan/);
  assert.match(result.content, /rata-rata=100/);
  assert.match(result.content, /Sheet: Catatan/);
});

test("formula cells are represented as literal formulas, not cached values", () => {
  const result = parseXlsxArrayBuffer(new ArrayBuffer(8), { name: "sales.xlsx", xlsx: fakeXlsx(true) });
  assert.match(result.content, /=40\+40/);
  assert.doesNotMatch(result.content, /\| Teh \| 80 \|/);
});

test("rejects non-xlsx files and files over the local size limit", async () => {
  await assert.rejects(parseXlsxLocally({ name: "report.xls", size: 8, arrayBuffer: async () => new ArrayBuffer(8) }, { xlsx: fakeXlsx() }), /\.xlsx/);
  await assert.rejects(parseXlsxLocally({ name: "large.xlsx", size: XLSX_MAX_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(8) }, { xlsx: fakeXlsx() }), /5 MB/);
});

test("rejects invalid ZIP signature before parsing", async () => {
  await assert.rejects(parseXlsxLocally({ name: "broken.xlsx", size: 8, arrayBuffer: async () => new ArrayBuffer(8) }, { xlsx: fakeXlsx() }), /bukan workbook/);
});
