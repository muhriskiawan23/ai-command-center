import test from "node:test";
import assert from "node:assert/strict";
import {
  DOCX_MAX_BYTES,
  DOCX_MAX_UNCOMPRESSED_BYTES,
  extractDocxParagraphs,
  parseDocxArrayBuffer,
  parseDocxLocally
} from "../public/docx-reader.js";

function streamEntry(value) {
  return {
    on(event, callback) { this.handlers ||= {}; this.handlers[event] = callback; return this; },
    resume() {
      const bytes = new TextEncoder().encode(value);
      for (let offset = 0; offset < bytes.length; offset += 7) this.handlers.data?.(bytes.slice(offset, offset + 7));
      this.handlers.end?.();
    },
    pause() { this.paused = true; }
  };
}
function makeZip({ huge = false, xml = '<w:document><w:body><w:p><w:r><w:t>Hello &amp; welcome</w:t></w:r></w:p><w:p><w:r><w:t>Revenue 2026</w:t></w:r></w:p></w:body></w:document>', reportedSize } = {}) {
  return { files: {
    "word/document.xml": {
      _data: { uncompressedSize: reportedSize ?? (huge ? DOCX_MAX_UNCOMPRESSED_BYTES + 1 : xml.length) },
      internalStream: () => streamEntry(xml)
    },
    "word/styles.xml": { _data: { uncompressedSize: 20 } }
  } };
}
const jszip = zip => ({ loadAsync: async () => zip });

test("extracts Word paragraphs and decodes XML entities in order", async () => {
  const result = await parseDocxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(makeZip()), name: "report.docx" });
  assert.equal(result.paragraphCount, 2);
  assert.match(result.content, /Hello & welcome/);
  assert.match(result.content, /Revenue 2026/);
  assert.equal(result.truncated, false);
});

test("extracts namespaced paragraph tags and ignores empty paragraphs", () => {
  assert.deepEqual(extractDocxParagraphs('<w:p><w:r><w:t>One</w:t></w:r></w:p><w:p/><w:p><w:r><w:t>Two &gt; one</w:t></w:r></w:p>'), ["One", "Two > one"]);
});

test("ignores fake Word tags inside XML comments and CDATA", () => {
  const xml = '<w:document><!-- <w:p><w:r><w:t>comment payload</w:t></w:r></w:p> --><w:p><w:r><w:t>Visible</w:t></w:r></w:p><![CDATA[<w:p><w:r><w:t>CDATA payload</w:t></w:r></w:p>]]></w:document>';
  assert.deepEqual(extractDocxParagraphs(xml), ["Visible"]);
});

test("enforces actual decompressed bytes even when ZIP metadata under-reports size", async () => {
  const oversizedXml = '<w:document>' + 'x'.repeat(DOCX_MAX_UNCOMPRESSED_BYTES + 1) + '</w:document>';
  const underreported = makeZip({ xml: oversizedXml, reportedSize: 1 });
  await assert.rejects(
    parseDocxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(underreported) }),
    /30 MB/
  );
});

test("rejects archives with excessive expanded size", async () => {
  await assert.rejects(parseDocxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(makeZip({ huge: true })) }), /30 MB/);
});

test("rejects oversized raw buffers and archives with too many entries", async () => {
  await assert.rejects(parseDocxArrayBuffer(new Uint8Array(DOCX_MAX_BYTES + 1)), /5 MB/);
  const files = Object.fromEntries(Array.from({ length: 2001 }, (_, i) => ["entry-" + i, {
    _data: { uncompressedSize: 0 }, async: async () => ""
  }]));
  await assert.rejects(parseDocxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip({ files }) }), /terlalu kompleks/);
});

test("rejects archives without Word document structure", async () => {
  const invalid = { files: { "document.xml": { _data: { uncompressedSize: 5 }, async: async () => "<x/>" } } };
  await assert.rejects(parseDocxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(invalid) }), /struktur dokumen Word/);
});

test("rejects empty Word documents and unsafe file sizes before parsing", async () => {
  await assert.rejects(parseDocxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(makeZip({ xml: "<w:document/>" })) }), /tidak memiliki teks/);
  await assert.rejects(parseDocxLocally({ name: "bad.pdf", size: 8, arrayBuffer: async () => new ArrayBuffer(8) }, { jszip: jszip(makeZip()) }), /\.docx/);
  await assert.rejects(parseDocxLocally({ name: "large.docx", size: DOCX_MAX_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(8) }, { jszip: jszip(makeZip()) }), /5 MB/);
});

test("rejects content that exceeds the bounded archive expansion limit", async () => {
  await assert.rejects(parseDocxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(makeZip({ huge: true })) }), /30 MB/);
});
