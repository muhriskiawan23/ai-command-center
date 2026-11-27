import { isSearchProviderConfigured } from "./research.js";
import { tavilyExtractionConfigured } from "./tavily-extract.js";
import { createVerifiedLinkFetcher } from "./verified-egress.js";

const limitationQuestions = {
  id: /^(?:apa(?: saja)? (?:kekurangan|keterbatasan)(?:mu| (?:kamu|lu|lo|anda|bor ai))|apa(?:kah)? batas kemampuan(?:mu| (?:kamu|lu|lo|anda|bor ai)))[?!.]*$/iu,
  en: /^(?:what are (?:your|bor ai(?:'|’)s) limitations|what can(?:'|’)t you do)[?!.]*$/iu
};

export function chatCapabilityOverview(message, env, signedIn) {
  const language = Object.keys(limitationQuestions).find(key => limitationQuestions[key].test(message));
  if (!language) return "";

  const webSearch = isSearchProviderConfigured(env);
  const linkReader = env.URL_READER_ENABLED === "true" && (env.URL_READER_PROVIDER === "tavily"
    ? tavilyExtractionConfigured(env)
    : Boolean(createVerifiedLinkFetcher(env) || typeof env.LINK_FETCHER === "function"));

  if (language === "id") {
    return [
      webSearch
        ? "**Pencarian web.** BOR AI bisa mencoba mencari sumber publik. Informasi terbaru baru bisa diperiksa setelah pencarian menemukan sumber yang relevan."
        : "**Pencarian web.** Pencarian sumber publik belum tersedia di sesi ini. Kamu bisa menempelkan kutipan yang ingin diperiksa.",
      linkReader
        ? "**Tautan.** Kirim URL publik yang ingin dibaca. Akses halaman dan kuota bisa membatasi hasilnya."
        : "**Tautan.** Pembacaan halaman web eksternal belum tersedia di sesi ini. Kamu bisa menempelkan isi halamannya.",
      "**Lampiran.** Gunakan tombol + untuk mengunggah PDF, DOCX, XLSX, PPTX, atau CSV. Analisis bergantung pada bagian file yang berhasil diproses.",
      "**Akurasi dan akses.** Jawaban bisa keliru atau melewatkan konteks. Periksa sumber untuk keputusan penting. BOR AI bisa menyiapkan draf. Pengiriman pesan dan perubahan di akun tetap kamu lakukan sendiri.",
      signedIn ? "Kalau ada jawaban yang keliru, tekan 👎 di bawah jawaban dan tambahkan alasan jika perlu." : "Masuk untuk memberi umpan balik lewat tombol 👎 di bawah jawaban."
    ].join("\n\n");
  }

  return [
    webSearch
      ? "**Web search.** BOR AI can look for public sources. Current information can be checked once the search finds relevant sources."
      : "**Web search.** Public web search is unavailable in this session. You can paste an excerpt for BOR AI to review.",
    linkReader
      ? "**Links.** Send a public URL to read. Page access and usage limits can affect what BOR AI retrieves."
      : "**Links.** External page reading is unavailable in this session. You can paste the page text into the chat.",
    "**Attachments.** Use the + button to upload PDF, DOCX, XLSX, PPTX, or CSV. Analysis depends on which parts of the file can be processed.",
    "**Accuracy and access.** Answers can be wrong or miss context. Check sources for important decisions. BOR AI can prepare drafts. Sending messages and changing your accounts still require your action.",
    signedIn ? "If an answer is wrong, select 👎 below it and add an optional reason." : "Sign in to leave feedback using 👎 below an answer."
  ].join("\n\n");
}
