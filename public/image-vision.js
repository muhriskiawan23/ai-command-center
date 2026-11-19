/* Prepare user-selected images locally. No network call occurs until Send.
 * All image formats become a bounded JPEG before invoking Workers AI vision.
 */
const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
const MAX_DATA_URL_CHARS = 760_000;

async function loadImageFromFile(file) {
  const objectUrl = URL.createObjectURL(file);
  const img = new Image();
  try {
    await new Promise((resolve, reject) => {
      let timeout;
      const finish = (error) => {
        clearTimeout(timeout);
        img.onload = null;
        img.onerror = null;
        if (error) reject(error); else resolve();
      };
      timeout = setTimeout(() => finish(new Error("Gagal membuka gambar dalam 15 detik.")), 15_000);
      img.onload = () => finish();
      img.onerror = () => finish(new Error("Format gambar tidak bisa dibaca di perangkat ini."));
      img.src = objectUrl;
    });
    return img;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function prepareImageForVision(file, {
  loadImage = loadImageFromFile,
  createCanvas = () => document.createElement("canvas"),
  onProgress = () => {}
} = {}) {
  if (!file || !TYPES.has(file.type) || !/\.(?:jpe?g|png|webp)$/i.test(file.name || "")) {
    throw new Error("Pilih gambar JPG, PNG, atau WEBP yang valid.");
  }
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    throw new Error("Ukuran foto maksimal 5 MB.");
  }

  onProgress("Menyiapkan foto untuk AI vision…");
  const img = await loadImage(file);
  const width = Number(img.naturalWidth || img.width);
  const height = Number(img.naturalHeight || img.height);
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) ||
      width < 1 || height < 1 || width * height > 24_000_000) {
    throw new Error("Resolusi foto terlalu besar atau tidak valid.");
  }

  const canvas = createCanvas();
  const ctx = canvas.getContext("2d", { alpha: false });
  if (!ctx) throw new Error("Browser tidak mendukung pemrosesan gambar lokal.");
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  // Keep screenshot text reasonably legible, then shrink progressively if needed.
  for (const maxSide of [1280, 1024, 800, 640]) {
    const scale = Math.min(1, maxSide / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    for (const quality of [0.82, 0.7, 0.58]) {
      const dataUrl = canvas.toDataURL("image/jpeg", quality);
      if (dataUrl.startsWith("data:image/jpeg;base64,") && dataUrl.length <= MAX_DATA_URL_CHARS) {
        onProgress("Foto siap dianalisis saat dikirim.");
        return {
          kind: "image-vision",
          name: String(file.name).replace(/[\/\\\x00-\x1f\x7f]/g, "_").replace(/\.(?:jpe?g|png|webp)$/i, ".jpg").slice(0, 120),
          dataUrl
        };
      }
    }
  }
  throw new Error("Foto terlalu kompleks untuk diproses. Coba perkecil resolusinya.");
}
