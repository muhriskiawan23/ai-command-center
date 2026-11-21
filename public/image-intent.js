// Shared by browser and Worker: no provider request or credit reservation occurs here.
// Treat an attached photo as vision by default unless the user actually requests a
// visual transformation. Explicit user modes always take precedence.
const ASK = /^(?:apa(?:kah)?|siapa|berapa|kenapa|mengapa|bagaimana|gimana|cara|tutorial|jelaskan|jelasin|deskripsikan|analisis|analisa|baca|bacakan|ringkas|terjemahkan|what|why|how|who|describe|analy[sz]e|read|summarize|translate|bantu saya (?:mempelajari|belajar|memahami|menjelaskan))\b/i;
const TEXT_ONLY = /\b(?:caption|deskripsi|penjelasan|cerita|ide|contoh prompt|prompt untuk|copywriting|saran|terjemahan|teks dalam|tulisan dalam|apa isi|what is|what does|meaning of)\b/i;
const EDIT = /\b(?:edit|ubah|ubah(?:kan)?|ganti|gantikan|jadikan|jadikanlah|perbaiki|perjelas|jernihkan|pertajam|tingkatkan kualitas|retouch|enhance|upscale|sharpen|recolor|recolour|replace|remove|hapus|hilangkan|buang|tambahkan|tambahin|pindahkan|potong|crop|rotate|putar|ubah warna|ganti warna)\b/i;
const VISUAL = /\b(?:gambar|foto|poster|banner|flyer|logo|ilustrasi|thumbnail|undangan|mockup|wallpaper|background|latar|stiker|avatar|ikon|icon|cover|komik|kartun|anime|render|image|picture|photo|illustration|sketch|drawing|artwork|graphic|art|visual|design)\b/i;
const CREATE = /\b(?:buat(?:kan)?|bikin(?:kan)?|desain(?:kan)?|design|generate|create|draw|draw me|paint|sketch|illustrate|render|lukis(?:kan)?|gambarkan)\b/i;
const CREATE_AT_START = /^(?:gambar(?:kan)?|lukis(?:kan)?|draw|paint|sketch|illustrate|render)\s+\S+/i;

// Contextual follow-ups can refer to the result of the preceding image job.
export function referencesEarlierImage(prompt) {
  const text = String(prompt || '').trim().toLowerCase();
  if (/^(?:apa|siapa|jelaskan|jelasin|deskripsikan|what|how|why|di mana|dimana)\b/.test(text)) return false;
  return /\b(?:gambar|foto|poster|hasil|image|picture)\s+(?:yang\s+)?(?:tadi|sebelumnya|terakhir)\b|\b(?:versi lain|versi berikutnya|buat ulang|edit lagi|ubah lagi|ganti lagi|lebih terang|lebih gelap|lebih cerah|make another version|same image)\b/.test(text);
}

export function imageIntent(prompt, hasSource = false, mode = 'auto') {
  if (mode === 'chat' || mode === 'analyze') return null;
  if (mode === 'generate' || mode === 'edit') return mode;
  const text = String(prompt || '').trim().toLowerCase();
  if (!text || ASK.test(text) || /^(?:jangan|tolong jangan|don't|do not)\b/.test(text)) return null;
  // A user asking for a *description*, tutorial, caption or prompt is asking
  // for text, even when an image file is attached.
  if (TEXT_ONLY.test(text) && !/\b(?:jadikan|ubah|ganti|hapus|remove|replace|edit)\b/.test(text)) return null;
  if (hasSource) {
    // Examples: "jadikan anime", "ganti langit", "buat poster dari foto ini".
    if (EDIT.test(text) || (CREATE.test(text) && VISUAL.test(text)) || referencesEarlierImage(text)) return 'edit';
    return null; // image question without edit instruction -> existing Vision.
  }
  if (CREATE.test(text) && VISUAL.test(text)) return 'generate';
  if (CREATE_AT_START.test(text) && !TEXT_ONLY.test(text)) return 'generate';
  // Without an attached image, editing requests should request the source,
  // not infer that the model can modify an image that doesn't exist.
  if (EDIT.test(text) && VISUAL.test(text)) return 'edit';
  return null;
}
