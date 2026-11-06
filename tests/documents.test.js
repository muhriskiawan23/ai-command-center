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

test("PDF conversion errors are returned as a safe failure", () => {
  assert.deepEqual(normalizePdfConversion({ format: "error", error: "private provider details" }, "bad.pdf"), { ok: false });
  assert.deepEqual(normalizePdfConversion({ format: "markdown", data: "" }, "empty.pdf"), { ok: false });
});

test("PDF filenames are reduced to safe display names", () => {
  assert.equal(safePdfName("../../private/report.pdf"), "______private_report.pdf");
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
