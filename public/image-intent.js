// Shared by browser and Worker. Explicit modes handle ambiguous prompts.
export function imageIntent(prompt, hasSource = false, mode = 'auto') {
  if (mode === 'chat' || mode === 'analyze') return null;
  if (mode === 'generate' || mode === 'edit') return mode;
  const text = String(prompt || '').toLowerCase();
  if (/^(?:bagaimana|gimana|cara|tutorial|jelaskan|how (?:to|do)|explain)\b/.test(text.trim())) return null;
  const edit = /\b(?:edit|enhance|upscale|sharpen|pertajam|perjelas|jernihkan|tingkatkan kualitas|ubah kualitas|hapus (?:background|latar|objek|orang)|remove (?:background|object)|ganti (?:background|latar)|(?:buat|bikin|jadi(?:kan)?|lebih) hd)\b/i;
  const create = /\b(?:buat(?:kan)?|bikin(?:kan)?|desain(?:kan)?|design|generate|create|draw|lukis(?:kan)?|gambar(?:kan)?|tambahkan|tambahin)\b[\s\S]{0,100}\b(?:gambar|foto|poster|banner|flyer|logo|ilustrasi|thumbnail|undangan|mockup|background|image|picture|illustration|teks|text)\b/i;
  const imageTarget = /\b(?:foto|gambar|image|photo|picture|background|latar|upscale|enhance|sharpen|hd)\b/.test(text);
  if (edit.test(text) && (hasSource || imageTarget)) return 'edit';
  if (create.test(text)) return hasSource ? 'edit' : 'generate';
  return null;
}
