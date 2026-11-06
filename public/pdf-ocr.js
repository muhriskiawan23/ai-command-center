const MAX_OCR_PAGES = 10;
const MAX_RENDER_DIMENSION = 1800;
const MAX_OCR_TEXT_CHARS = 48000;

export async function ocrScannedPdf(file, {
  pdfjs = globalThis.pdfjsLib,
  tesseract = globalThis.Tesseract,
  onProgress = () => {},
  createWorker = tesseract?.createWorker?.bind(tesseract)
} = {}) {
  if (!file || typeof file.arrayBuffer !== "function") throw new Error("File PDF tidak valid.");
  if (!pdfjs?.getDocument || !createWorker) throw new Error("Komponen OCR belum termuat. Periksa koneksi lalu muat ulang halaman.");
  const buffer = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise;
  if (!Number.isInteger(pdf.numPages) || pdf.numPages < 1) throw new Error("Halaman PDF tidak ditemukan.");
  if (pdf.numPages > MAX_OCR_PAGES) throw new Error("PDF scan memiliki "+pdf.numPages+" halaman. OCR lokal dibatasi maksimal "+MAX_OCR_PAGES+" halaman per file.");
  let worker;
  const pages = [];
  let totalChars = 0;
  try {
    onProgress({ status: "loading-language", progress: 0, page: 0, total: pdf.numPages });
    worker = await createWorker("eng+ind", 1, {
      logger: message => onProgress({ status: message.status || "loading-language", progress: message.progress || 0, page: 0, total: pdf.numPages }),
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
      langPath: "https://tessdata.projectnaptha.com/4.0.0",
      gzip: true
    });
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      onProgress({ status: "rendering", progress: pageNumber / pdf.numPages, page: pageNumber, total: pdf.numPages });
      const page = await pdf.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2, MAX_RENDER_DIMENSION / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(viewport.width));
      canvas.height = Math.max(1, Math.ceil(viewport.height));
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) throw new Error("Browser tidak dapat menyiapkan gambar OCR.");
      await page.render({ canvasContext: context, viewport }).promise;
      onProgress({ status: "recognizing", progress: pageNumber / pdf.numPages, page: pageNumber, total: pdf.numPages });
      const result = await worker.recognize(canvas);
      const text = String(result?.data?.text || "").trim();
      canvas.width = 0; canvas.height = 0;
      if (text) {
        const block = "### Page " + pageNumber + "\\n" + text;
        const remaining = MAX_OCR_TEXT_CHARS - totalChars;
        if (remaining <= 0) break;
        const clipped = block.slice(0, remaining);
        pages.push(clipped);
        totalChars += clipped.length + 2;
      } else pages.push("### Page " + pageNumber + "\\n[No readable text detected]");
      page.cleanup?.();
    }
  } finally {
    if (worker) await worker.terminate();
    await pdf.destroy?.();
  }
  const content = pages.join("\\n\\n").slice(0, MAX_OCR_TEXT_CHARS).trim();
  if (!content || !pages.some(page => !page.includes("[No readable text detected]"))) throw new Error("OCR tidak menemukan teks yang dapat dibaca. Coba PDF dengan resolusi lebih tinggi.");
  return {
    name: String(file.name || "scanned.pdf").replace(/[\\/\\\\\\u0000-\\u001f]/g, "_").slice(0, 180),
    content,
    pageCount: pdf.numPages,
    truncated: totalChars >= MAX_OCR_TEXT_CHARS,
    ocr: true
  };
}
