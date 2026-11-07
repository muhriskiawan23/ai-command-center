import test from "node:test";
import assert from "node:assert/strict";
import { validateCitationReferences } from "../src/citations.js";

const successful = [{ sourceId: 1, ok: true }];
const failed = [{ sourceId: 1, ok: false }];

test("menghapus sitasi yang tidak valid termasuk ID lebih dari tiga digit", () => {
  const result = validateCitationReferences("Fakta [1] dan klaim [1000].", successful);
  assert.equal(result, "Fakta [1] dan klaim.\n\nCatatan sumber: sitasi yang tidak cocok dengan sumber berhasil diambil telah dihapus.");
});

test("mempertahankan indeks array dan kode inline maupun fenced", () => {
  const input = "Gunakan items[0] untuk nilai pertama.\n\n\`const x = items[0];\`\n\n\`\`\`js\nconst y = items[1000];\n\`\`\`";
  assert.equal(validateCitationReferences(input, successful), input);
});

test("menghapus sitasi gagal tanpa merusak spasi dan tanda baca", () => {
  const result = validateCitationReferences("Fakta [1].\nLanjutkan paragraf.", failed);
  assert.equal(result, "Fakta.\nLanjutkan paragraf.\n\nCatatan sumber: tidak ada sumber yang berhasil diambil. Jawaban di atas tidak didukung oleh sumber eksternal yang diminta.");
});

test("tidak mengubah jawaban jika tidak ada metadata tautan", () => {
  const input = "Kode: items[0] dan sitasi [999].";
  assert.equal(validateCitationReferences(input, []), input);
});

test("menghapus Markdown citation link yang tidak punya sumber sah dan mempertahankan yang valid", () => {
  const input = "Fakta [1](https://source.example/one), klaim palsu [2](https://evil.example/two).";
  const result = validateCitationReferences(input, successful);
  assert.match(result, /\[1\]\(https:\/\/source\.example\/one\)/);
  assert.doesNotMatch(result, /evil\.example|\[2\]/);
  assert.match(result, /sitasi yang tidak cocok/);
});

test("Markdown citation link tidak dibersihkan di dalam fenced atau inline code", () => {
  const input = "`[999](https://example.com)`\n\n```md\n[888](https://example.com)\n```";
  assert.equal(validateCitationReferences(input, successful), input);
});
