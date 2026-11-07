/* BOR AI locale bootstrap: automatic device language with an explicit user override. */
(() => {
  const STORAGE_KEY = "borai-language-preference";
  const supported = new Set(["id", "en"]);
  const translations = {
    en: {
      "Memuat BOR AI…": "Loading BOR AI…",
      "BOR AI membutuhkan JavaScript untuk berjalan.": "BOR AI requires JavaScript to run.",
      "Riset, analisis, ide, coding, dan perencanaan bersama asisten AI multi-agent.": "Research, analysis, ideas, coding, and planning with a multi-agent AI assistant.",
      "Lanjutkan dengan Google": "Continue with Google",
      "Lanjutkan sebagai Guest": "Continue as Guest",
      "Periksa status akun lagi": "Check account status again",
      "Akun Google": "Google account",
      "riwayat chat tersimpan di server dan hanya ditampilkan untuk akun Anda. Bisa dihapus kapan saja.": "chat history is stored on the server and only shown to your account. You can delete it anytime.",
      "Guest": "Guest",
      "tanpa akun. Chat tidak disimpan dan hilang saat halaman dimuat ulang.": "no account required. Chats are not saved and disappear when the page reloads.",
      "Pesan Anda diproses oleh layanan AI. Jangan mengirim data sensitif atau rahasia.": "Your messages are processed by AI services. Do not send sensitive or confidential data.",
      "Navigasi": "Navigation",
      "Cari percakapan": "Search conversations",
      "Chat baru": "New chat",
      "Percakapan": "Conversations",
      "Lihat arsip": "View archive",
      "Penggunaan": "Usage",
      "Penggunaan hari ini": "Today's usage",
      "Muat ulang penggunaan": "Refresh usage",
      "Integrasi": "Integrations",
      "Memori": "Memory",
      "Tentang BOR AI": "About BOR AI",
      "Hapus semua riwayat": "Delete all history",
      "Ekspor chat": "Export chat",
      "Cetak PDF": "Print PDF",
      "Memeriksa layanan…": "Checking service…",
      "Berpikir lebih jernih. Bekerja lebih terarah.": "Think smarter. Do more.",
      "Ruang kerja AI terpadu untuk riset, analisis, penulisan, dan pengembangan.": "One AI workspace for research, analysis, writing, and building.",
      "Perencanaan strategis": "Strategic planning",
      "Susun prioritas dan langkah eksekusi": "Set priorities and define execution steps",
      "Analisis mendalam": "In-depth analysis",
      "Evaluasi opsi, risiko, dan trade-off": "Evaluate options, risks, and trade-offs",
      "Pengembangan ide": "Idea development",
      "Ubah gagasan menjadi konsep konkret": "Turn ideas into concrete concepts",
      "Engineering & coding": "Engineering & coding",
      "Review, debugging, dan solusi teknis": "Reviews, debugging, and technical solutions",
      "Kirim pesan ke BOR AI…": "Message BOR AI…",
      "Kirim pesan": "Send message",
      "Hentikan generasi": "Stop generating",
      "Enter = baris baru · tekan ↑ untuk kirim": "Enter = new line · press ↑ to send",
      "AI dapat membuat kesalahan. Periksa kembali informasi penting sebelum mengambil keputusan.": "AI can make mistakes. Verify important information before making decisions."
    }
  };
  const getPreference = () => {
    try { return localStorage.getItem(STORAGE_KEY) || "auto"; } catch { return "auto"; }
  };
  const detect = () => {
    const candidates = navigator.languages?.length ? navigator.languages : [navigator.language || "en"];
    for (const candidate of candidates) {
      const code = String(candidate).toLowerCase().split("-")[0];
      if (supported.has(code)) return code;
    }
    return "en";
  };
  const apply = (preference) => {
    const language = preference === "auto" ? detect() : supported.has(preference) ? preference : "en";
    document.documentElement.lang = language;
    document.documentElement.dataset.language = language;
    const heading = document.querySelector("#welcome h1");
    if (heading) heading.textContent = language === "en" ? "Think smarter. Do more." : "Berpikir lebih jernih. Bekerja lebih terarah.";
    if (language === "en") {
      const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const original = node.nodeValue.trim();
        const translated = translations.en[original];
        if (translated) node.nodeValue = node.nodeValue.replace(original, translated);
      }
      const prompt = document.querySelector("#prompt");
      if (prompt) { prompt.placeholder = "Message BOR AI…"; prompt.setAttribute("aria-label", "Message BOR AI"); }
      const search = document.querySelector("#historySearch");
      if (search) search.placeholder = "⌕  Search conversations...";
    }
    const picker = document.querySelector("#languagePreference");
    if (picker) picker.value = preference;
  };
  document.addEventListener("DOMContentLoaded", () => {
    const topbar = document.querySelector(".topbar-actions");
    if (topbar && !document.querySelector("#languagePreference")) {
      const wrap = document.createElement("label");
      wrap.className = "language-picker";
      wrap.setAttribute("aria-label", "Display language");
      const select = document.createElement("select");
      select.id = "languagePreference";
      select.title = "Display language";
      select.innerHTML = '<option value="auto">🌐 Auto</option><option value="en">English</option><option value="id">Bahasa Indonesia</option>';
      select.addEventListener("change", () => {
        try { localStorage.setItem(STORAGE_KEY, select.value); } catch {}
        location.reload();
      });
      wrap.append(select);
      topbar.prepend(wrap);
    }
    apply(getPreference());
  });
})();
