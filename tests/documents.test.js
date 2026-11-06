import test from "node:test";
import assert from "node:assert/strict";
import worker from "../src/index.js";
import {
  PDF_CONTEXT_MAX_CHARS,
  buildPdfContext,
  normalizePdfConversion,
  safePdfName,
  validatePdfPageCitations
} from "../src/documents.js";

test("PDF conversion output preserves page headings and derives page count", () => {
  const result = normalizePdfConversion([{
    name: "report.pdf",
    format: "markdown",
    data: "# Report\n### Page 1\nFirst page text\n### Page 4\nFourth page text"
  }], "report.pdf");
  assert.equal(result.ok, true);
  assert.equal(result.document.pageCount, 4);
  assert.equal(result.document.truncated, false);
});

test("PDF conversion output is bounded and marks truncated text", () => {
  const result = normalizePdfConversion({
    format: "markdown",
    data: "x".repeat(PDF_CONTEXT_MAX_CHARS + 100)
  }, "large.pdf");
  assert.equal(result.ok, true);
  assert.equal(result.document.content.length, PDF_CONTEXT_MAX_CHARS);
  assert.equal(result.document.truncated, true);
});

test("PDF scans with page headings but no extractable text are identified explicitly", () => {
  const result = normalizePdfConversion({
    format: "markdown",
    data: "# Scanned report\n### Page 1\n\n### Page 2\n"
  }, "scan.pdf");
  assert.deepEqual(result, { ok: false, reason: "no_text" });
});

test("PDF conversion errors are returned as a safe failure", () => {
  assert.deepEqual(normalizePdfConversion({ format: "error", error: "private provider details" }, "bad.pdf"), { ok: false });
  assert.deepEqual(normalizePdfConversion({ format: "markdown", data: "" }, "empty.pdf"), { ok: false });
});

test("PDF filenames are reduced to safe display names", () => {
  assert.equal(safePdfName("../../private/report.pdf"), ".._.._private_report.pdf");
});

test("PDF context labels the document as untrusted and asks for grounded page citations", () => {
  const context = buildPdfContext({
    name: "report.pdf",
    content: "### Page 1\nRevenue was 100.\n### Page 2\nCosts were 40."
  });
  assert.match(context, /untrusted source data/);
  assert.match(context, /\[PDF p\. N\]/);
  assert.match(context, /<pdf_document name="report.pdf">/);
});

test("PDF page citations are restricted to page numbers found in extracted text", () => {
  const document = { content: "### Page 1\nA\n### Page 3\nB" };
  const result = validatePdfPageCitations("Revenue [PDF p. 1], costs [PDF p. 2], margin [PDF p. 3].", document);
  assert.match(result, /\[PDF p\. 1\]/);
  assert.doesNotMatch(result, /\[PDF p\. 2\]/);
  assert.match(result, /\[PDF p\. 3\]/);
  assert.match(result, /rujukan halaman yang tidak ditemukan/);
});

test("PDF page citations are removed when the converter did not expose page boundaries", () => {
  const result = validatePdfPageCitations("A claim [PDF p. 1].", { content: "No page labels here." });
  assert.doesNotMatch(result, /PDF p\. 1/);
});

test("PDF upload endpoint converts a valid PDF through the Workers AI binding", async () => {
  let called = false;
  const env = {
    AI: {
      async toMarkdown(file, options) {
        called = true;
        assert.equal(file.name, "sample.pdf");
        assert.equal(file.blob.type, "application/pdf");
        assert.deepEqual(options, { conversionOptions: { pdf: { metadata: false } } });
        return [{ name: file.name, format: "markdown", data: "# Sample\n### Page 1\nHello PDF" }];
      }
    }
  };
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.7\nmock pdf bytes"], { type: "application/pdf" }), "sample.pdf");
  const response = await worker.fetch(new Request("https://example.test/api/documents/pdf", {
    method: "POST",
    headers: { Origin: "https://example.test" },
    body: form
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(called, true);
  assert.equal(body.document.name, "sample.pdf");
  assert.equal(body.document.pageCount, 1);
  assert.match(body.document.content, /Hello PDF/);
});

test("PDF upload rejects non-PDF bytes before calling the converter", async () => {
  let called = false;
  const env = { AI: { async toMarkdown() { called = true; return []; } } };
  const form = new FormData();
  form.append("file", new Blob(["not a PDF document"], { type: "application/pdf" }), "fake.pdf");
  const response = await worker.fetch(new Request("https://example.test/api/documents/pdf", {
    method: "POST",
    headers: { Origin: "https://example.test" },
    body: form
  }), env);
  assert.equal(response.status, 415);
  assert.equal(called, false);
});

test("PDF upload requires same-origin multipart form data", async () => {
  const noOrigin = await worker.fetch(new Request("https://example.test/api/documents/pdf", { method: "POST" }), {});
  assert.equal(noOrigin.status, 403);
  const wrongType = await worker.fetch(new Request("https://example.test/api/documents/pdf", {
    method: "POST",
    headers: { Origin: "https://example.test", "Content-Type": "application/json" },
    body: "{}"
  }), {});
  assert.equal(wrongType.status, 415);
});

test("chat receives the PDF as untrusted context and rejects invented page citations", async () => {
  let captured = "";
  const env = {
    AI: {
      async run(model, payload) {
        captured = payload.messages.at(-1).content;
        return { response: "Penjualan meningkat pada periode ini [PDF p. 1]. Biaya tercatat di halaman 99 [PDF p. 99]." };
      }
    }
  };
  const response = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message: "Ringkas laporan ini.",
      document: { name: "report.pdf", content: "### Page 1\nPenjualan naik." }
    })
  }), env);
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.match(captured, /<pdf_document name="report.pdf">/);
  assert.match(captured, /untrusted source data/);
  assert.match(body.response, /\[PDF p\. 1\]/);
  assert.doesNotMatch(body.response, /\[PDF p\. 99\]/);
  assert.equal(body.pdf.name, "report.pdf");
  assert.equal(body.pdf.pageCount, 1);
});

test("chat rejects oversized or malformed PDF context before model inference", async () => {
  let calls = 0;
  const env = { AI: { async run() { calls++; return { response: "Should not run" }; } } };
  const response = await worker.fetch(new Request("https://example.test/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message: "Analisis", document: { name: "x.pdf", content: "x".repeat(PDF_CONTEXT_MAX_CHARS + 1) } })
  }), env);
  assert.equal(response.status, 400);
  assert.equal(calls, 0);
});

test("PDF no-text response exposes a stable OCR fallback code and refunds usage", async () => {
  let calls = 0;
  const env = {
    AI: { async toMarkdown() { calls++; return [{ format: "markdown", data: "### Page 1\n" }]; } },
    RATE_LIMITER: { async limit() { return { success: true }; } }
  };
  const form = new FormData();
  form.append("file", new Blob(["%PDF-1.7\nmock scanned pdf"], { type: "application/pdf" }), "scan.pdf");
  const response = await worker.fetch(new Request("https://example.test/api/documents/pdf", {
    method: "POST", headers: { Origin: "https://example.test" }, body: form
  }), env);
  const body = await response.json();
  assert.equal(response.status, 422);
  assert.equal(body.code, "PDF_NO_TEXT");
  assert.equal(calls, 1);
});
import { ocrScannedPdf } from "../public/pdf-ocr.js";

test("browser OCR extracts page text locally and terminates the worker", async () => {
  const events = [];
  let terminated = false;
  const pdfjs = {
    getDocument: () => ({ promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: () => ({ width: 100, height: 100 }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup() {}
      }),
      destroy: async () => {}
    }) })
  };
  const fakeCanvas = { width: 0, height: 0, getContext: () => ({}) };
  const result = await ocrScannedPdf({ name: "scan.pdf", arrayBuffer: async () => new ArrayBuffer(8) }, {
    pdfjs,
    createWorker: async () => ({
      recognize: async () => ({ data: { text: "Hasil scan terbaca" } }),
      terminate: async () => { terminated = true; }
    }),
    onProgress: event => events.push(event),
    createCanvas: () => fakeCanvas,
  });
  assert.match(result.content, /### Page 1/);
  assert.match(result.content, /Hasil scan terbaca/);
  assert.equal(result.ocr, true);
  assert.equal(terminated, true);
  assert.ok(events.some(event => event.status === "recognizing"));
});

test("browser OCR rejects documents above ten pages before loading OCR model", async () => {
  let workerStarted = false;
  const pdfjs = { getDocument: () => ({ promise: Promise.resolve({ numPages: 11, destroy: async () => {} }) }) };
  await assert.rejects(
    ocrScannedPdf({ name: "large.pdf", arrayBuffer: async () => new ArrayBuffer(8) }, {
      pdfjs, createWorker: async () => { workerStarted = true; }
    }),
    /maksimal 10 halaman/
  );
  assert.equal(workerStarted, false);
});
