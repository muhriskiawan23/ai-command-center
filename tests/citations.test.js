import test from "node:test";
import assert from "node:assert/strict";
import { validateCitationReferences } from "../src/citations.js";

const successful = [{ sourceId: 1, ok: true }];
const failed = [{ sourceId: 1, ok: false }];

test("menghapus sitasi yang tidak valid termasuk ID lebih dari tiga digit", () => {
  const result = validateCitationReferences("Fakta [1] dan klaim [1000].", successful);
  assert.equal(result, "Fakta [1] dan klaim.\n\nCatatan sumber: sitasi yang tidak cocok dengan sumber berhasil dibaca telah dihapus.");
});

test("mempertahankan indeks array dan kode inline maupun fenced", () => {
  const input = "Gunakan items[0] untuk nilai pertama.\n\n\`const x = items[0];\`\n\n\`\`\`js\nconst y = items[1000];\n\`\`\`";
  assert.equal(validateCitationReferences(input, successful), input);
});

test("menghapus sitasi gagal tanpa merusak spasi dan tanda baca", () => {
  const result = validateCitationReferences("Fakta [1].\nLanjutkan paragraf.", failed);
  assert.equal(result, "Fakta.\nLanjutkan paragraf.\n\nCatatan sumber: tidak ada tautan yang berhasil dibaca. Jawaban di atas tidak bersumber dari halaman yang diminta.");
});

test("tidak mengubah jawaban jika tidak ada metadata tautan", () => {
  const input = "Kode: items[0] dan sitasi [999].";
  assert.equal(validateCitationReferences(input, []), input);
});
