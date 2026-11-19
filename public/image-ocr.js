/* Local OCR for image attachments; no raw image upload to an external model.
 * All pixels remain in the browser; only recognized text is sent with a chat.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 9000;
const OCR_INIT_TIMEOUT_MS = 45_000;
const OCR_RECOGNITION_TIMEOUT_MS = 45_000;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function timeoutAfter(ms, message) {
  let timer;
  const promise = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  return { promise, cancel: () => clearTimeout(timer) };
}

export async function parseImageOcrLocally(file, {
  tesseract = globalThis.Tesseract,
  createWorker = tesseract?.createWorker?.bind(tesseract),
  onProgress = () => {},
  initTimeoutMs = OCR_INIT_TIMEOUT_MS,
  recognitionTimeoutMs = OCR_RECOGNITION_TIMEOUT_MS
} = {}) {
  if (!file || !TYPES.has(file.type) || !/\.(?:jpe?g|png|webp)$/i.test(file.name || "")) {
    throw new Error("Pilih gambar JPG, PNG atau WEBP yang valid.");
  }
  if (file.size < 1 || file.size > MAX_BYTES) throw new Error("Ukuran gambar harus 1 byte–5 MB.");
  if (!createWorker) throw new Error("Komponen OCR belum siap. Muat ulang halaman dan coba lagi.");

  let worker;
  let finished = false;
  let rejectWorkerFailure;
  const workerFailure = new Promise((_, reject) => { rejectWorkerFailure = reject; });
  try {
    onProgress("Memuat model OCR di perangkat…");
    const setupLimit = timeoutAfter(initTimeoutMs,
      "Persiapan OCR terlalu lama. Periksa koneksi internet lalu coba lagi, atau gunakan gambar lebih kecil.");

    // Tesseract can leave createWorker pending forever if its language download
    // fails. Bound the wait, surface worker errors, and clean up late workers.
    const initializing = Promise.resolve().then(() => createWorker("eng+ind", 1, {
      workerPath: "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath: "https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
      langPath: "https://tessdata.projectnaptha.com/4.0.0_fast",
      gzip: true,
      errorHandler: error => {
        if (!finished) rejectWorkerFailure(new Error("Gagal memuat mesin OCR. Periksa koneksi dan coba lagi."));
      },
      logger: event => {
        if (finished) return;
        const progress = Number(event?.progress);
        if (!Number.isFinite(progress) || progress < 0 || progress > 1) return;
        const percent = Math.round(progress * 100);
        const recognizing = /recogniz/i.test(String(event?.status || ""));
        // A zero is an initialization stage, not evidence of a stalled upload.
        onProgress(percent === 0
          ? (recognizing ? "Mulai mengenali teks…" : "Memuat model OCR di perangkat…")
          : (recognizing ? "Mengenali teks" : "Menyiapkan OCR") + " · " + percent + "%");
      }
    }));
    // If the download finishes after a timeout, prevent an orphaned worker.
    initializing.then(async lateWorker => {
      if (finished) {
        try { await lateWorker?.terminate?.(); } catch {}
      }
    }, () => {});
    try {
      worker = await Promise.race([initializing, workerFailure, setupLimit.promise]);
    } finally {
      setupLimit.cancel();
    }
    if (!worker || typeof worker.recognize !== "function") throw new Error("Mesin OCR tidak dapat dijalankan.");

    onProgress("Membaca teks pada gambar…");
    const recognitionLimit = timeoutAfter(recognitionTimeoutMs,
      "Pembacaan gambar terlalu lama. Coba perkecil gambar atau unggah ulang.");
    let result;
    try {
      result = await Promise.race([worker.recognize(file), workerFailure, recognitionLimit.promise]);
    } finally {
      recognitionLimit.cancel();
    }
    const raw = String(result?.data?.text || "").trim();
    if (!raw) throw new Error("Tidak ada teks yang dapat dibaca dalam gambar. BOR AI belum menganalisis gambar tanpa teks.");
    const content = raw.slice(0, MAX_TEXT_CHARS);
    return {
      kind: "image-ocr",
      name: String(file.name || "image.jpg").replace(/[\/\\\x00-\x1f\x7f]/g, "_").slice(0, 120),
      content,
      truncated: raw.length > content.length
    };
  } finally {
    finished = true;
    try { await worker?.terminate?.(); } catch {}
  }
}
