import { planBrowserTask, validateBrowserTarget, BROWSER_MAX_TEXT_CHARS } from "./browser-task-policy.js";

// Only called by the dedicated staging Worker after operator authentication,
// a fixed pilot hostname match and atomic D1 budget/lease admission.
// The launcher is injected for offline tests; the staging entrypoint supplies
// Cloudflare Playwright's launch() and the BOR_BROWSER binding.
const NAVIGATION_MS = 12_000;
const FULL_SESSION_MS = 25_000;
const MAX_LINKS = 20;

function deny(code) { return { ok: false, code }; }
async function bounded(promise, milliseconds) {
  let timer;
  try {
    return await Promise.race([
      Promise.resolve(promise),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("browser_deadline")), milliseconds);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
function trim(value, limit) {
  return typeof value === "string" ? value.slice(0, limit) : "";
}
function isPermittedRequest(raw, method, host) {
  if (!["GET", "HEAD"].includes(method)) return false;
  const check = validateBrowserTarget(raw);
  return check.ok && check.hostname === host;
}

export async function executeStagingBrowserRead(url, env, { launch } = {}) {
  if (env?.STAGING_BROWSER_ENABLED !== "true") return deny("browser_disabled");
  const preview = planBrowserTask({ url, steps: [{ type: "read_text" }] }, { ownHost: env.STAGING_BROWSER_OWN_HOST || "" });
  if (!preview.ok) return deny(preview.code);
  const host = preview.plan.hostname;
  // Staging pilot is restricted to ONE hostname configured by the operator.
  // Never accept an arbitrary target just because the client supplied it.
  if (typeof env.STAGING_BROWSER_PILOT_HOST !== "string" ||
      host !== env.STAGING_BROWSER_PILOT_HOST.trim().toLowerCase()) return deny("outside_pilot_hostname");
  if (!env.BOR_BROWSER || typeof launch !== "function") return deny("browser_not_connected");

  let browser, context;
  let lateBrowserPromise;
  const started = Date.now();
  const remainingMs = (stageMax) => Math.max(1, Math.min(stageMax, FULL_SESSION_MS - (Date.now() - started)));
  try {
    const guardedLaunch = Promise.resolve().then(() => launch(env.BOR_BROWSER, {
      guardrails: { allowedDomains: [host] }
    }));
    lateBrowserPromise = guardedLaunch;
    try {
      browser = await bounded(guardedLaunch, remainingMs(7_000));
    } catch {
      // If the provider resolves after a timeout, close that late session too.
      guardedLaunch.then(late => { try { void late?.close?.(); } catch {} }).catch(() => {});
      return deny("browser_launch_failed");
    }
    if (!browser?.newContext) return deny("browser_invalid_session");
    context = await bounded(browser.newContext({
      acceptDownloads: false,
      serviceWorkers: "block",
      permissions: []
    }), remainingMs(4_000));
    if (!context?.newPage || !context?.route) return deny("browser_invalid_context");

    // Additional request-layer restrictions. Browser Run session guardrails
    // are mandatory and remain the primary provider-side hostname control.
    await bounded(context.route("**/*", route => {
      let permitted = false;
      try {
        const request = route.request();
        permitted = isPermittedRequest(request.url(), request.method(), host);
      } catch {}
      return permitted ? route.continue() : route.abort("blockedbyclient");
    }), remainingMs(3_000));

    const page = await bounded(context.newPage(), remainingMs(3_000));
    if (!page?.goto || !page?.url || !page?.evaluate || !page?.title) return deny("browser_invalid_page");
    const response = await bounded(page.goto(preview.plan.url, {
      waitUntil: "domcontentloaded",
      timeout: NAVIGATION_MS
    }), remainingMs(NAVIGATION_MS + 500));
    const finalUrl = page.url();
    const final = validateBrowserTarget(finalUrl);
    if (!final.ok || final.hostname !== host) return deny("navigation_not_permitted");
    const status = typeof response?.status === "function" ? response.status() : null;
    if (!Number.isInteger(status) || status < 200 || status >= 400) return deny("page_unavailable");
    const title = trim(await bounded(page.title(), remainingMs(1_500)), 160);
    // The browser executes its own page javascript; BOR AI treats the
    // returned DOM text as *untrusted evidence*, never as agent instructions.
    const text = trim(await bounded(
      page.evaluate(max => String(document.body?.innerText || "").slice(0, max + 1), BROWSER_MAX_TEXT_CHARS),
      remainingMs(2_000)
    ), BROWSER_MAX_TEXT_CHARS + 1);
    const truncated = text.length > BROWSER_MAX_TEXT_CHARS;
    const rawLinks = await bounded(page.evaluate(limit =>
      Array.from(document.querySelectorAll("a[href]")).slice(0, limit * 2)
        .map(link => ({ url: link.href, label: String(link.innerText || "").slice(0, 100) })),
      MAX_LINKS
    ), remainingMs(2_000));
    const links = Array.isArray(rawLinks) ? rawLinks
      .filter(item => item && typeof item.url === "string" &&
        isPermittedRequest(item.url, "GET", host))
      .slice(0, MAX_LINKS)
      .map(item => ({ url: item.url, label: trim(item.label, 100) })) : [];
    if (!text.trim()) return deny("page_text_empty");
    if (Date.now() - started > FULL_SESSION_MS) return deny("browser_session_timeout");
    return {
      ok: true, status: "page_read", sourceType: "browser_read",
      requestedUrl: preview.plan.url, resolvedUrl: final.url,
      httpStatus: status, title, text: text.slice(0, BROWSER_MAX_TEXT_CHARS),
      truncated, links, renderedInBrowserSession: true,
      // Provenance means real staged browser returned page text, NOT that
      // claims in the untrusted page have been independently fact checked.
      dataTrust: "untrusted_external", actionsPerformed: ["navigate", "read_text"]
    };
  } catch {
    return deny("browser_read_failed");
  } finally {
    // Best-effort cleanup with its own bound; Cloudflare also enforces session
    // timeouts if a runtime crashes or fails to close.
    try { if (context?.close) await bounded(context.close(), 1_000); } catch {}
    try { if (browser?.close) await bounded(browser.close(), 1_000); } catch {}
  }
}
