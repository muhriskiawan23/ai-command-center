(() => {
  "use strict";

  const button = document.getElementById("openBillingStatus");
  const panel = document.getElementById("billingStatusPanel");
  const summary = document.getElementById("billingStatusSummary");
  const refresh = document.getElementById("refreshBillingStatus");
  if (!button || !panel || !summary || !refresh) return;

  const labels = {
    not_enrolled: "Akun ini belum terdaftar untuk layanan billing.",
    under_review: "Status akun sedang ditinjau.",
    blocked: "Layanan billing untuk akun ini belum tersedia."
  };

  let pending = false;
  let loaded = false;

  async function loadStatus(force = false) {
    if (pending || (loaded && !force)) return;
    pending = true;
    refresh.disabled = true;
    summary.textContent = "Memeriksa status akun…";

    try {
      const response = await fetch("/api/billing/account", {
        method: "GET",
        credentials: "same-origin",
        headers: { Accept: "application/json" },
        cache: "no-store"
      });

      let body = null;
      try { body = await response.json(); } catch {}

      if (response.status === 401) {
        summary.textContent = "Sesi Google tidak aktif. Masuk kembali untuk memeriksa status akun.";
      } else if (response.status === 404) {
        summary.textContent = "Pemeriksaan status akun belum tersedia di server.";
      } else if (!response.ok) {
        summary.textContent = "Status akun belum dapat dimuat. Coba lagi sebentar.";
      } else if (!body || typeof body.accountStatus !== "string" ||
                 !Object.hasOwn(labels, body.accountStatus) ||
                 body.billingReady !== false ||
                 body.commercialEntitlement !== false ||
                 body.credits !== null ||
                 body.productionCheckoutEnabled !== false ||
                 body.realCreditsGranted !== false ||
                 body.realSubscriptionEnabled !== false) {
        summary.textContent = "Respons status akun tidak valid. Data billing tidak ditampilkan.";
      } else {
        summary.textContent = labels[body.accountStatus];
      }
      loaded = response.ok;
    } catch {
      summary.textContent = "Tidak dapat menghubungi server. Periksa koneksi lalu coba lagi.";
    } finally {
      pending = false;
      refresh.disabled = false;
    }
  }

  function toggle(force) {
    const open = typeof force === "boolean" ? force : panel.hidden;
    panel.hidden = !open;
    button.setAttribute("aria-expanded", String(open));
    if (open) loadStatus();
  }

  button.addEventListener("click", () => toggle());
  refresh.addEventListener("click", () => loadStatus(true));
})();
