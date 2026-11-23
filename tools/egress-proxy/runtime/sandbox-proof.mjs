import fs from "node:fs";
import { spawn } from "node:child_process";
import { summarizeCliFailure } from "./safe-diagnostics.mjs";
import { waitForProbe, safeProbeError, fetchAuthenticatedProbe } from "./probe-client.mjs";
import { cleanupProbe } from "./cleanup-probe.mjs";

const cfg = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
const productionService = "01a1cefa-5d93-7da2-bfce-91aae9fe11f1";
const token = process.env.EGRESS_PROXY_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const run = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT;
function requireCheck(value, code) { if (!value) throw Error(code); }
requireCheck(process.env.GITHUB_REF === "refs/heads/main", "main_required");
requireCheck(/^\d+$/.test(run || "") && /^\d+$/.test(attempt || ""), "actions_context_required");
requireCheck(token?.length >= 32 && !/\s/.test(token) && account && apiToken, "credentials_missing_or_invalid");
const sandboxService = process.env.SANDBOX_EGRESS_VPC_SERVICE_ID;
requireCheck(/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(sandboxService || ""), "sandbox_vpc_service_required");
requireCheck(sandboxService.toLowerCase() !== productionService, "production_vpc_service_forbidden");

// Keep CLI output and API response bodies private, including errors. No artifacts contain secrets.
async function cli(args, input = "") {
  await new Promise((resolve, reject) => {
    let output = "";
    const child = spawn("npx", ["--yes", "wrangler@4", ...args], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" }
    });
    const capture = chunk => { output = (output + chunk.toString()).slice(-65536); };
    child.stdout.on("data", capture);
    child.stderr.on("data", capture);
    child.on("error", () => reject(Error("wrangler_start_failed")));
    child.stdin.on("error", () => {});
    child.on("close", code => {
      if (code === 0) return resolve();
      console.error("wrangler_failure=" + JSON.stringify({ exitCode: code, ...summarizeCliFailure(output, [token, account, apiToken]) }));
      reject(Error("wrangler_operation_failed"));
    });
    child.stdin.end(input);
  });
}
async function api(path) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/${path}`, {
    headers: { authorization: `Bearer ${apiToken}` }, signal: AbortSignal.timeout(20000)
  });
  requireCheck(response.ok, "cloudflare_metadata_http_failed");
  const body = await response.json();
  requireCheck(body.success === true, "cloudflare_metadata_api_failed");
  return body.result;
}
const probeName = `bor-egress-proof-${run}-${attempt}`;
const probeConfig = "tools/egress-proxy/runtime/wrangler.sandbox.generated.json";
let probeMayExist = false;
let stage = "verify_infrastructure_access";
try {
  await api("connectivity/directory/services/" + sandboxService);
  console.log("sandbox_vpc_resource_access=verified");
  const subdomain = await api("workers/subdomain");
  requireCheck(/^[a-z0-9-]+$/.test(subdomain.subdomain || ""), "worker_subdomain_unverified");
  const fixtureOrigin = `https://${probeName}.${subdomain.subdomain}.workers.dev`;
  fs.writeFileSync(probeConfig, JSON.stringify({
    name: probeName, main: "probe-worker.js", compatibility_date: cfg.compatibility_date,
    compatibility_flags: cfg.compatibility_flags, workers_dev: true,
    vpc_services: [{ binding: "EGRESS_PROXY", service_id: sandboxService }], observability: { enabled: false }, vars: { FIXTURE_ORIGIN: fixtureOrigin }
  }));
  stage = "deploy_isolated_probe";
  probeMayExist = true;
  await cli(["deploy", "--config", probeConfig]);
  await cli(["secret", "put", "EGRESS_PROXY_TOKEN", "--config", probeConfig], token + "\n");
  stage = "probe_endpoint_readiness";
  const endpoint = fixtureOrigin + "/run";
  // A public caller cannot trigger the probe. It never accepts caller-provided targets.
  await waitForProbe(endpoint, { report: console.log });
  stage = "probe_private_path";
  const response = await fetchAuthenticatedProbe(endpoint, token, { report: console.log });
  const proof = await response.json().catch(() => null);
  console.log("probe_runtime_http_status=" + response.status);
  if (!response.ok) console.log("probe_runtime_diagnostic=" + JSON.stringify(safeProbeError({ message: proof?.diagnostic?.reason, proxyStatus: proof?.diagnostic?.proxyStatus })));
  requireCheck(response.ok, "private_runtime_probe_failed");
  requireCheck(proof.ok === true && proof.checks?.authenticationDenied === true && proof.checks?.unsafeDestinationsDenied === true && proof.checks?.productionAdapterPeerAndTlsVerified === true, "runtime_evidence_incomplete");
  const extended = ["controlledOriginVerified", "expiredTlsDenied", "wrongHostTlsDenied", "selfSignedTlsDenied", "privateRedirectDenied", "responseLimitDenied", "proxyTimeoutDenied", "callerAbortBounded"];
  requireCheck(extended.every(key => proof.checks[key] === true), "extended_runtime_evidence_incomplete");
  console.log("hosted_negative_checks=" + JSON.stringify(Object.fromEntries(extended.map(key => [key, true]))));
  console.log("worker_vpc_tunnel_proxy_runtime_proof=PASS; auth_denial=PASS; unsafe_ip_denial=PASS; peer_tls=PASS");
  stage = "bounded_stability_sampling";
  for (let sample = 1; sample <= 6; sample++) {
    if (sample > 1) await new Promise(resolve => setTimeout(resolve, 30000));
    const sampled = await fetchAuthenticatedProbe(fixtureOrigin + "/sample", token, { attempts: 1, report: console.log });
    const value = await sampled.json().catch(() => null);
    requireCheck(sampled.ok && value?.ok === true && value.checks?.authenticationDenied === true && value.checks?.unsafeDestinationsDenied === true && value.checks?.productionAdapterPeerAndTlsVerified === true, "stability_sample_failed");
    console.log("bounded_stability_sample=" + sample + "/6; result=PASS");
  }
  console.log("bounded_stability=PASS; samples=6; minimum_span_seconds=150; long_term_stability=UNVERIFIED");
  console.log("sandbox_probe=PASS; production_not_evaluated=true");
} catch {
  console.error(`egress_setup=FAILED; stage=${stage}; url_reader_activation=NOT_PERFORMED`);
  process.exitCode = 1;
} finally {
  if (probeMayExist) {
    try { await cleanupProbe(process.env); }
    catch { console.error("temporary_probe_cleanup=FAILED; remove the run-specific proof Worker"); process.exitCode = 1; }
  }
  fs.rmSync(probeConfig, { force: true });
}
