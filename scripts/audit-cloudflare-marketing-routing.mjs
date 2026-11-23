// Manual read-only routing inventory for BOR AI. Never mutates Cloudflare resources.
// Uses existing GitHub Actions secrets, with all response bodies kept out of logs.
// Required read-only Cloudflare scopes for the full inventory:
// Zone > Zone Read, DNS Read, Workers Routes Read (getborai.com zone);
// Account > Workers Scripts Read (or Workers Metadata Read-Only), Pages Read.
// A 403 or missing zone visibility is NOT proof of safe DNS/Worker routing.
const token = process.env.CLOUDFLARE_AUDIT_API_TOKEN || process.env.CLOUDFLARE_API_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token || !account) {
  console.error("AUDIT BLOCKED: Cloudflare account ID or audit/API token unavailable.");
  process.exit(1);
}
const roots = new Set(["getborai.com", "app.getborai.com", "www.getborai.com"]);
const headers = { Authorization: "Bearer " + token, Accept: "application/json" };
let complete = true;

async function request(path, label) {
  try {
    const response = await fetch("https://api.cloudflare.com/client/v4" + path, {
      method: "GET", headers, redirect: "error", signal: AbortSignal.timeout(20000)
    });
    if (!response.ok) {
      // Log numeric Cloudflare error codes only; never log response text,
      // token values, headers or any arbitrary server-provided messages.
      let errorCodes = "";
      try {
        const failed = await response.json();
        const codes = [...new Set((Array.isArray(failed?.errors) ? failed.errors : [])
          .map((error) => error?.code)
          .filter((code) => Number.isSafeInteger(code)))];
        if (codes.length) errorCodes = " API error codes=" + codes.join(",");
      } catch { /* Response body intentionally suppressed. */ }
      console.log(label + ": UNVERIFIED HTTP " + response.status + errorCodes +
        (response.status === 403 ? " (check token permissions, scope and account)" : "") +
        " (response body suppressed)");
      complete = false;
      return null;
    }
    const payload = await response.json();
    if (payload?.success !== true) {
      console.log(label + ": UNVERIFIED API envelope (body suppressed)");
      complete = false;
      return null;
    }
    return payload;
  } catch {
    console.log(label + ": UNVERIFIED request error or timeout (details suppressed)");
    complete = false;
    return null;
  }
}

async function collect(path, label, perPage = 100, useDefaultPageSize = false) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    // Pages API documents page and per_page as optional. Start with its
    // documented bare GET, and preserve its own default page size for page 2+.
    const query = useDefaultPageSize
      ? (page === 1 ? "" : sep + "page=" + page)
      : sep + "per_page=" + perPage + "&page=" + page;
    const payload = await request(path + query, label);
    if (!payload) return null;
    if (!Array.isArray(payload.result)) {
      console.log(label + ": UNVERIFIED unexpected collection shape");
      complete = false;
      return null;
    }
    all.push(...payload.result);
    const total = payload.result_info?.total_pages;
    if (Number.isInteger(total)) {
      // Cloudflare can report zero pages for an empty first response.
      if (total === 0 && page === 1 && payload.result.length === 0) return all;
      if (total < page || total > 10) {
        console.log(label + ": UNVERIFIED inconsistent/large pagination");
        complete = false;
        return null;
      }
      if (page === total) return all;
    } else {
      const expectedPageSize = useDefaultPageSize
        ? payload.result_info?.per_page : perPage;
      if (!Number.isInteger(expectedPageSize) || expectedPageSize < 1) {
        console.log(label + ": UNVERIFIED missing pagination metadata");
        complete = false;
        return null;
      }
      if (payload.result.length < expectedPageSize) return all;
    }
  }
  console.log(label + ": UNVERIFIED pagination limit reached");
  complete = false;
  return null;
}
function hostName(value) {
  return typeof value === "string" ? value.replace(/\.$/, "").toLowerCase() : "";
}
function printList(label, entries) {
  if (!entries) return;
  console.log(label + ": " + (entries.length ? entries.join(" | ") : "none matched"));
}

const zones = await collect("/zones?name=getborai.com", "Zone lookup");
let zoneId = null;
if (zones) {
  const selected = zones.filter((z) => z?.name === "getborai.com");
  if (selected.length !== 1 || typeof selected[0]?.id !== "string") {
    console.log("Zone lookup: UNVERIFIED (getborai.com not visible under token scope/account or no unique matching zone)");
    complete = false;
  } else {
    zoneId = encodeURIComponent(selected[0].id);
    console.log("Zone lookup: verified; status=" + (selected[0].status === "active" ? "active" : "not confirmed active"));
    if (selected[0].status !== "active") complete = false;
  }
}
if (zoneId) {
  const dns = await collect("/zones/" + zoneId + "/dns_records", "DNS records");
  if (dns) printList("Public host DNS record types/proxy status", dns
    .filter((d) => roots.has(hostName(d.name)))
    .map((d) => hostName(d.name) + ":" + String(d.type || "unknown") + ":proxied=" + String(d.proxied === true))
  );
  const routes = await collect("/zones/" + zoneId + "/workers/routes", "Worker routes");
  if (routes) printList("Worker route patterns touching BOR AI hosts", routes
    .filter((r) => typeof r.pattern === "string" && r.pattern.includes("getborai.com"))
    .map((r) => r.pattern + " -> " + String(r.script || "none"))
  );
}
const domains = await collect("/accounts/" + encodeURIComponent(account) + "/workers/domains", "Worker custom domains");
if (domains) printList("Worker custom-domain bindings", domains
  .filter((d) => roots.has(hostName(d.hostname || d.domain)))
  .map((d) => hostName(d.hostname || d.domain) + " -> " + String(d.service || "unknown"))
);
// Start Pages inventory with no optional query parameters; Pages API can
// reject paging combinations. Fail closed if its own pagination is incomplete.
const projects = await collect("/accounts/" + encodeURIComponent(account) + "/pages/projects", "Pages projects", 100, true);
if (projects) printList("Pages projects with BOR AI custom domains", projects
  .filter((p) => Array.isArray(p.domains) && p.domains.some((d) => roots.has(hostName(d))))
  .map((p) => String(p.name || "unnamed") + ":" + p.domains.filter((d) => roots.has(hostName(d))).join(","))
);
console.log("Zone page/redirect rules: NOT AUDITED; review separately before apex cutover.");
console.log("Result: " + (complete
  ? "READ INVENTORY COMPLETE for checked APIs; routing conflicts still require human review."
  : "INCOMPLETE — missing access/metadata; DO NOT change apex routes or DNS."));
if (!complete) process.exitCode = 1;
