import { validateUrl } from "./links.js";

// Policy-only foundation. NOT wired to /api/chat, a Cloudflare browser binding,
// external HTTP, credentials, or production Web Actions. No live browser launches.
export const BROWSER_POLICY_VERSION = "preview-v1";
export const BROWSER_MAX_STEPS = 6;
export const BROWSER_MAX_SESSION_SECONDS = 30;
export const BROWSER_MAX_TEXT_CHARS = 12000;

const READ_ONLY = new Set(["read_text", "inspect_links", "screenshot"]);
const REQUIRE_APPROVAL = new Set(["click", "fill"]);
const ALLOWED = new Set([...READ_ONLY, ...REQUIRE_APPROVAL]);
const SENSITIVE_PATH = /(?:^|\/)(?:oauth|callback|signin|sign-in|login|reset|verify|confirm|invite|token|session|checkout|payment)(?:\/|$)/i;
const SELECTOR = /^(?:[a-z][a-z0-9_-]*|#[a-z][a-z0-9_-]*|\.[a-z][a-z0-9_-]*|\[data-testid="[a-zA-Z0-9_.:-]{1,70}"\])$/i;

function denied(code) { return { ok: false, code }; }
function onlyKeys(record, keys) {
  return Object.keys(record).every(key => keys.includes(key));
}

// This intentionally rejects query strings until token/signed-link privacy
// handling is reviewed. Valid HTTP(S) syntax alone does not prove DNS/SSRF safety.
export function validateBrowserTarget(raw, ownHost = "") {
  if (typeof raw !== "string" || raw.length > 750) return denied("invalid_url");
  const checked = validateUrl(raw, ownHost);
  if (!checked.ok) return denied("unsafe_url");
  const url = new URL(checked.url.toString());
  if (url.protocol !== "https:") return denied("https_only");
  if (url.search || url.hash) return denied("private_url_parameters");
  if (SENSITIVE_PATH.test(url.pathname)) return denied("sensitive_url_path");
  const hostname = url.hostname.toLowerCase();
  // Pilot scope: public DNS names only; never raw IP literals, localhost or
  // special-purpose hostnames. Managed provider guardrails are additional,
  // not an independently verified DNS/IP enforcement mechanism.
  if (!/^[a-z0-9.-]+$/.test(hostname) || hostname.startsWith("[") ||
      /^[0-9.]+$/.test(hostname) || !hostname.includes(".") ||
      hostname.split(".").some(label => !label || label.startsWith("-") || label.endsWith("-")))
    return denied("hostname_not_supported");
  url.hash = "";
  return { ok: true, url: url.toString(), hostname };
}

// Returns a non-executable preview. User-supplied input values are never echoed
// into the preview or logs. "click" and "fill" are not runnable by this module.
export function planBrowserTask(input, { ownHost = "" } = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input) ||
      !onlyKeys(input, ["url", "steps"])) return denied("invalid_request");
  const target = validateBrowserTarget(input.url, ownHost);
  if (!target.ok) return target;
  const steps = input.steps === undefined ? [{ type: "read_text" }] : input.steps;
  if (!Array.isArray(steps) || steps.length < 1 || steps.length > BROWSER_MAX_STEPS)
    return denied("step_limit");
  const normalized = [];
  for (const step of steps) {
    if (!step || typeof step !== "object" || Array.isArray(step) ||
        typeof step.type !== "string" || !ALLOWED.has(step.type))
      return denied("action_not_supported");
    if (READ_ONLY.has(step.type)) {
      if (!onlyKeys(step, ["type"])) return denied("unknown_action_parameter");
      normalized.push({ type: step.type });
      continue;
    }
    if (step.type === "click") {
      if (!onlyKeys(step, ["type", "selector"]) || typeof step.selector !== "string" ||
          step.selector.length > 100 || !SELECTOR.test(step.selector))
        return denied("unsafe_selector");
      normalized.push({ type: "click", selector: step.selector, requiresUserApproval: true });
      continue;
    }
    if (!onlyKeys(step, ["type", "selector", "value"]) ||
        typeof step.selector !== "string" || step.selector.length > 100 ||
        !SELECTOR.test(step.selector) || typeof step.value !== "string" ||
        step.value.length < 1 || step.value.length > 250)
      return denied("invalid_fill");
    // Do not retain passwords, personal data or form contents in task previews.
    normalized.push({ type: "fill", selector: step.selector,
      valueRedacted: true, requiresUserApproval: true });
  }
  const approvalRequired = normalized.some(step => REQUIRE_APPROVAL.has(step.type));
  return {
    ok: true,
    plan: {
      version: BROWSER_POLICY_VERSION,
      mode: "preview_only",
      url: target.url,
      hostname: target.hostname,
      guardrails: { allowedDomains: [target.hostname] },
      limits: {
        maxSteps: BROWSER_MAX_STEPS,
        maxNavigations: 1,
        maxSessionSeconds: BROWSER_MAX_SESSION_SECONDS,
        maxTextCharacters: BROWSER_MAX_TEXT_CHARS
      },
      steps: normalized,
      approvalRequired,
      executionEnabled: false
    }
  };
}

// No Cloudflare Browser Run invocation exists here. To graduate to live usage,
// build a separately audited runtime with provider-side guardrails, per-user
// budget admission, isolated incognito sessions and an owner-approved release.
export function browserExecutionGate(env = {}, preview = null) {
  if (!preview?.ok || !preview?.plan) return denied("invalid_plan");
  if (preview.plan.approvalRequired) return denied("action_requires_approval");
  if (env.BOR_BROWSER_AUTOMATION_ENABLED !== "true") return denied("feature_disabled");
  return denied("browser_runtime_not_connected");
}
