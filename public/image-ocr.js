/* Local OCR for image attachments; no raw image upload to an external model.
 * All pixels remain in the browser; only recognized text is sent with a chat.
 */
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 9000;
const TYPES = new Set(["image/jpeg","image/png","image/webp"]);
export async function parseImageOcrLocally(file,{ tesseract=globalThis.Tesseract,createWorker=tesseract?.createWorker?.bind(tesseract),onProgress=()=>{} }={}) {
  if(!file||!TYPES.has(file.type)||!/\.(?:jpe?g|png|webp)$/i.test(file.name||""))throw new Error("Pilih gambar JPG, PNG atau WEBP yang valid.");
  if(file.size<1||file.size>MAX_BYTES)throw new Error("Ukuran gambar harus 1 byte–5 MB.");
  if(!createWorker)throw new Error("Komponen OCR belum siap. Muat ulang halaman dan coba lagi.");
  let worker;
  try {
    onProgress("Menyiapkan OCR di perangkat (0%)…");
    worker=await createWorker("eng+ind",1,{
      workerPath:"https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js",
      corePath:"https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1",
      langPath:"https://tessdata.projectnaptha.com/4.0.0",
      gzip:true,
      logger:event=>{
        const progress=Number(event?.progress);
        if(!Number.isFinite(progress)||progress<0||progress>1)return;
        const percent=Math.round(progress*100);
        const status=String(event?.status||"");
        // Expose only readiness/progress, never OCR text, raw pixels, or URLs.
        onProgress((/recogniz/i.test(status)?"Mengenali teks":"Menyiapkan OCR")+" · "+percent+"%");
      }
    });
    onProgress("Membaca teks pada gambar…");
    const result=await worker.recognize(file);
    const raw=String(result?.data?.text||"").trim();
    if(!raw)throw new Error("Tidak ada teks yang dapat dibaca dalam gambar. BOR AI belum menganalisis gambar tanpa teks.");
    const content=raw.slice(0,MAX_TEXT_CHARS);
    return {
      kind:"image-ocr",
      name:String(file.name||"image.jpg").replace(/[\/\\\x00-\x1f\x7f]/g,"_").slice(0,120),
      content,
      truncated:raw.length>content.length
    };
  } finally {await worker?.terminate?.();}
}
