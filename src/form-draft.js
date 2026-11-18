// Public feedback form *draft*, not an OAuth connection or an auto-published form.
// Only a user running the generated script in their own Google account can create it.
export function planFeedbackForm(message) {
  const text = String(message || "").trim().slice(0, 12000);
  const create = /\b(buat|bikin|create|generate|rancang|siapkan|buatkan|make)\b/i.test(text);
  const form = /\b(formulir|form|survey|survei|kuesioner)\b/i.test(text);
  const feedback = /\b(feedback|masukan|saran|penilaian|kepuasan|suggestion|review)\b/i.test(text);
  if (!create || !form || !feedback) return null;
  const bor = /\bBOR[\s-]*AI\b/i.test(text);
  const title = bor ? "BOR AI — Masukan & Saran Publik" : "Formulir Masukan & Saran";
  return {
    kind: "google-forms-apps-script",
    title,
    notice: "Rancangan saja. Google Form belum dibuat atau dibagikan. Jalankan sendiri di Google Apps Script menggunakan akunmu.",
    items: [
      { title: bor ? "Apakah kamu pernah mencoba BOR AI?" : "Apakah kamu pernah mencoba layanan ini?", type: "choice", choices: ["Sudah", "Belum"], required: true },
      { title: "Hal apa yang paling kamu butuhkan?", type: "checkbox", choices: ["Jawaban lebih akurat", "Browsing dan baca tautan", "Upload dan analisis file", "Desain lebih nyaman", "Privasi dan keamanan", "Harga lebih terjangkau", "Lainnya"], required: false },
      { title: "Seberapa penting kualitas jawaban AI bagimu? (1–5)", type: "scale", required: true },
      { title: "Fitur apa yang paling ingin kamu lihat?", type: "paragraph", required: false },
      { title: "Apa masalah terbesar yang pernah kamu alami?", type: "paragraph", required: false },
      { title: "Bagaimana pendapatmu tentang desain dan kemudahan penggunaan?", type: "paragraph", required: false },
      { title: "Apakah kamu punya kekhawatiran tentang privasi atau keamanan?", type: "paragraph", required: false },
      { title: "Saran atau rekomendasi lainnya", type: "paragraph", required: false }
    ]
  };
}
export function generateFormsScript(draft) {
  if (!draft || draft.kind !== "google-forms-apps-script" ||
    typeof draft.title !== "string" || draft.title.length > 150 ||
    !Array.isArray(draft.items) || draft.items.length < 1 || draft.items.length > 20) {
    throw new TypeError("invalid_form_draft");
  }
  for (const item of draft.items) {
    if (!item || typeof item.title !== "string" || item.title.length > 200 ||
      !["choice", "checkbox", "scale", "paragraph"].includes(item.type) ||
      typeof item.required !== "boolean" ||
      (["choice", "checkbox"].includes(item.type) &&
        (!Array.isArray(item.choices) || item.choices.length < 2 || item.choices.length > 12 ||
          item.choices.some(value => typeof value !== "string" || value.length > 120)))) {
      throw new TypeError("invalid_form_item");
    }
  }
  const serialised = JSON.stringify({ title: draft.title, items: draft.items });
  return "// Run this function yourself in https://script.google.com after reviewing it.\n" +
    "// It creates ONE Google Form in the account that authorizes the script.\n" +
    "function createFeedbackForm() {\n" +
    "  const draft = " + serialised + ";\n" +
    "  const form = FormApp.create(draft.title);\n" +
    "  form.setDescription('Masukan bersifat sukarela. Jangan masukkan password, KTP atau data sensitif.');\n" +
    "  form.setCollectEmail(false);\n" +
    "  for (const q of draft.items) {\n" +
    "    let item;\n" +
    "    if (q.type === 'choice') item = form.addMultipleChoiceItem().setChoiceValues(q.choices);\n" +
    "    else if (q.type === 'checkbox') item = form.addCheckboxItem().setChoiceValues(q.choices);\n" +
    "    else if (q.type === 'scale') item = form.addScaleItem().setBounds(1, 5);\n" +
    "    else item = form.addParagraphTextItem();\n" +
    "    item.setTitle(q.title).setRequired(q.required);\n" +
    "  }\n" +
    "  console.log('EDIT URL: ' + form.getEditUrl());\n" +
    "  console.log('REVIEW RESPONDENT LINK BEFORE SHARING: ' + form.getPublishedUrl());\n" +
    "}\n";
}
