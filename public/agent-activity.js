"use strict";
/**
 * BOR AI Agent Activity — presentation only.
 * Displays real client chat lifecycle events. This is NOT a background task runner.
 * No API calls, secrets, prompt persistence, or synthetic progress percentages.
 */
(() => {
  const $ = id => document.getElementById(id);
  const trigger = $("agentActivityTrigger");
  const panel = $("agentActivityPanel");
  const backdrop = $("agentActivityBackdrop");
  const close = $("agentActivityClose");
  const stop = $("agentActivityStop");
  const toggle = $("agentActivityMotion");
  const status = $("agentActivityStatus");
  const task = $("agentActivityTask");
  const agent = $("agentActivityAgent");
  const details = $("agentActivityDetails");
  const tools = $("agentActivityTools");
  if (![trigger, panel, backdrop, close, stop, toggle, status, task, agent, details, tools].every(Boolean)) return;

  const MOTION_KEY = "bor-agent-activity-motion";
  let current = { phase: "idle", requestId: null, agent: "", task: "", toolActivity: [] };
  let isOpen = false;

  function savedMotion() {
    try { return localStorage.getItem(MOTION_KEY) === "on"; }
    catch { return false; }
  }
  function applyMotion() {
    document.documentElement.classList.toggle("bor-living-b-motion", toggle.checked);
    try { localStorage.setItem(MOTION_KEY, toggle.checked ? "on" : "off"); }
    catch { /* Private browsing can block localStorage; the current selection still works. */ }
  }
  toggle.checked = savedMotion();
  applyMotion();
  toggle.addEventListener("change", applyMotion);

  function setOpen(next, restoreFocus = false) {
    isOpen = Boolean(next);
    panel.hidden = !isOpen;
    backdrop.hidden = !isOpen;
    trigger.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) close.focus();
    else if (restoreFocus) trigger.focus();
  }
  trigger.addEventListener("click", () => setOpen(!isOpen, isOpen));
  close.addEventListener("click", () => setOpen(false, true));
  backdrop.addEventListener("click", () => setOpen(false, true));
  document.addEventListener("keydown", event => {
    if (!isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false, true);
    }
    if (event.key === "Tab") {
      // Keep keyboard focus inside the modal panel, including on small screens.
      const controls = [close, stop, toggle].filter(control => !control.disabled && !control.hidden);
      const first = controls[0], last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
  });

  function render() {
    const labels = {
      idle: "Belum ada aktivitas dalam tab ini.",
      running: "Menunggu jawaban BOR AI…",
      stopping: "Meminta penghentian…",
      completed: "BOR AI telah mengirim jawaban.",
      cancelled: "Permintaan dihentikan dari perangkat ini.",
      failed: "Permintaan tidak berhasil diselesaikan."
    };
    trigger.dataset.activityPhase = current.phase;
    status.textContent = labels[current.phase] || labels.idle;
    status.dataset.phase = current.phase;
    task.textContent = current.task || "Kirim pesan untuk memulai tugas.";
    agent.textContent = current.agent ? "Agen: " + current.agent : "Aktivitas chat saat ini";
    stop.disabled = current.phase !== "running";
    details.textContent = current.phase === "cancelled"
      ? "Penghentian di browser tidak menjamin semua proses server langsung berhenti."
      : current.phase === "running"
      ? "Status ini menunjukkan permintaan sedang menunggu respons, bukan persentase kemajuan."
      : "Panel ini hanya menampilkan aktivitas yang terjadi di tab ini. Tidak ada tugas latar belakang yang dijalankan.";

    tools.replaceChildren();
    const completedTools = Array.isArray(current.toolActivity) ? current.toolActivity : [];
    for (const entry of completedTools.slice(0, 8)) {
      if (!entry || typeof entry !== "object") continue;
      const item = document.createElement("li");
      const name = typeof entry.tool === "string" ? entry.tool.replace(/[_-]/g, " ").slice(0, 60) : "Tool";
      const raw = typeof entry.status === "string" ? entry.status.slice(0, 40) : "unknown";
      item.textContent = name + " — " + raw;
      tools.append(item);
    }
    tools.hidden = tools.childElementCount === 0;
  }

  stop.addEventListener("click", () => {
    if (current.phase !== "running") return;
    const existingStop = $("stopGeneration");
    if (!existingStop || existingStop.disabled) return;
    existingStop.click(); // Reuse existing AbortController-backed cancellation.
    current.phase = "stopping";
    render();
  });

  // Never carry text from a previous guest/account session into a new one.
  window.addEventListener("bor:session-state", () => {
    current = { phase: "idle", requestId: null, agent: "", task: "", toolActivity: [] };
    setOpen(false);
    render();
  });

  window.addEventListener("bor:agent-activity", event => {
    const data = event.detail;
    if (!data || typeof data !== "object") return;
    if (data.phase === "started" && typeof data.requestId === "string") {
      current = {
        phase: "running",
        requestId: data.requestId,
        task: typeof data.task === "string" ? data.task.replace(/\s+/g, " ").slice(0, 160) : "",
        agent: typeof data.agent === "string" ? data.agent.slice(0, 60) : "",
        toolActivity: []
      };
    } else {
      if (!current.requestId || data.requestId !== current.requestId) return;
      if (data.phase === "completed") {
        current.phase = "completed";
        current.toolActivity = Array.isArray(data.toolActivity) ? data.toolActivity : [];
      } else if (data.phase === "cancelled") {
        current.phase = "cancelled";
      } else if (data.phase === "failed") {
        current.phase = "failed";
      } else {
        return;
      }
    }
    render();
  });

  render();
})();
