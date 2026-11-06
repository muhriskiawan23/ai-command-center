import test from "node:test";
import assert from "node:assert/strict";
import { parsePptxArrayBuffer, parsePptxLocally, PPTX_MAX_BYTES, PPTX_MAX_UNCOMPRESSED_BYTES } from "../public/pptx-reader.js";

function makeZip(huge = false) {
  const data = {
    "ppt/presentation.xml": '<p:presentation><p:sldIdLst><p:sldId r:id="rId2"/><p:sldId r:id="rId1"/></p:sldIdLst></p:presentation>',
    "ppt/_rels/presentation.xml.rels": '<Relationships><Relationship Id="rId1" Target="slides/slide1.xml"/><Relationship Id="rId2" Target="slides/slide2.xml"/></Relationships>',
    "ppt/slides/slide1.xml": '<p:sld><a:p><a:t>Ringkasan &amp; Tujuan</a:t></a:p><a:p><a:t>Target 2026</a:t></a:p></p:sld>',
    "ppt/slides/slide2.xml": '<p:sld><a:p><a:t>Analisis Pasar</a:t></a:p><a:p><a:t>Pendapatan &gt; biaya</a:t></a:p></p:sld>'
  };
  return { files: Object.fromEntries(Object.entries(data).map(([path, content]) => [path, {
    _data: { uncompressedSize: huge && path.endsWith("slide1.xml") ? PPTX_MAX_UNCOMPRESSED_BYTES + 1 : content.length },
    async: async () => content
  }])) };
}
const jszip = zip => ({ loadAsync: async () => zip });

test("extracts slide text in presentation order and decodes XML entities", async () => {
  const result = await parsePptxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(makeZip()), name: "pitch.pptx" });
  assert.equal(result.slideCount, 2);
  assert.match(result.content, /Slide 1\nAnalisis Pasar\nPendapatan > biaya/);
  assert.match(result.content, /Slide 2\nRingkasan & Tujuan\nTarget 2026/);
  assert.equal(result.truncated, false);
});

test("rejects archives with excessive expanded size", async () => {
  await assert.rejects(parsePptxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(makeZip(true)) }), /30 MB/);
});

test("rejects archives without presentation structure", async () => {
  const invalid = { files: { "document.xml": { _data: { uncompressedSize: 5 }, async: async () => "<x/>" } } };
  await assert.rejects(parsePptxArrayBuffer(new Uint8Array([80, 75, 3, 4]), { jszip: jszip(invalid) }), /struktur presentasi/);
});

test("rejects wrong extension and oversized files before parsing", async () => {
  await assert.rejects(parsePptxLocally({ name: "report.pdf", size: 8, arrayBuffer: async () => new ArrayBuffer(8) }, { jszip: jszip(makeZip()) }), /\.pptx/);
  await assert.rejects(parsePptxLocally({ name: "large.pptx", size: PPTX_MAX_BYTES + 1, arrayBuffer: async () => new ArrayBuffer(8) }, { jszip: jszip(makeZip()) }), /5 MB/);
});
