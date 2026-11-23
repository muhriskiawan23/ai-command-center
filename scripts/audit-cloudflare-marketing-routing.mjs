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
      console.log(label + ": UNVERIFIED HTTP " + response.status +
        (response.status === 403 ? " (check token permissions, scope and account)" : "") +
        " (no response body logged)");
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

async function collect(path, label) {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const sep = path.includes("?") ? "&" : "?";
    const payload = await request(path + sep + "per_page=100&page=" + page, label);
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
      // Treat that as empty, not malformed, so missing zone visibility is explicit.
      if (total === 0 && page === 1 && payload.result.length === 0) return all;
      if (total < page || total > 10) {
        console.log(label + ": UNVERIFIED inconsistent/large pagination");
        complete = false;
        return null;
      }
      if (page === total) return all;
    } else if (payload.result.length < 100) {
      return all;
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
const projects = await collect("/accounts/" + encodeURIComponent(account) + "/pages/projects", "Pages projects");
if (projects) printList("Pages projects with BOR AI custom domains", projects
  .filter((p) => Array.isArray(p.domains) && p.domains.some((d) => roots.has(hostName(d))))
  .map((p) => String(p.name || "unnamed") + ":" + p.domains.filter((d) => roots.has(hostName(d))).join(","))
);
console.log("Zone page/redirect rules: NOT AUDITED; review separately before apex cutover.");
console.log("Result: " + (complete
  ? "READ INVENTORY COMPLETE for checked APIs; routing conflicts still require human review."
  : "INCOMPLETE — missing access/metadata; DO NOT change apex routes or DNS."));
if (!complete) process.exitCode = 1;
