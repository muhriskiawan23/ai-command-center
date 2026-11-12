import fs from "node:fs";
import { spawn } from "node:child_process";

const cfg = JSON.parse(fs.readFileSync("wrangler.jsonc", "utf8"));
const token = process.env.EGRESS_PROXY_TOKEN;
const account = process.env.CLOUDFLARE_ACCOUNT_ID;
const apiToken = process.env.CLOUDFLARE_API_TOKEN;
const run = process.env.GITHUB_RUN_ID;
const attempt = process.env.GITHUB_RUN_ATTEMPT;
function requireCheck(value, code) { if (!value) throw Error(code); }
requireCheck(process.env.GITHUB_REF === "refs/heads/main", "main_required");
requireCheck(/^\d+$/.test(run || "") && /^\d+$/.test(attempt || ""), "actions_context_required");
requireCheck(token?.length >= 32 && !/\s/.test(token) && account && apiToken, "credentials_missing_or_invalid");
requireCheck(cfg.name === "ai-command-center" && cfg.vars?.URL_READER_ENABLED === "false", "production_off_guard_required");
requireCheck(cfg.vpc_services?.length === 1 && cfg.vpc_services[0].binding === "EGRESS_PROXY" && cfg.vpc_services[0].service_id === "01a1cefa-5d93-7da2-bfce-91aae9fe11f1", "vpc_config_mismatch");

// Keep CLI output and API response bodies private, including errors. No artifacts contain secrets.
async function cli(args, input = "") {
  await new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "wrangler@4", ...args], {
      stdio: ["pipe", "ignore", "ignore"],
      env: { ...process.env, WRANGLER_SEND_METRICS: "false" }
    });
    child.on("error", () => reject(Error("wrangler_start_failed")));
    child.stdin.on("error", () => {});
    child.on("close", code => code === 0 ? resolve() : reject(Error("wrangler_operation_failed")));
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
async function verifyProduction(requireSecret) {
  const settings = await api("workers/scripts/ai-command-center/settings");
  const bindings = settings.bindings || [];
  requireCheck(bindings.some(b => b.name === "URL_READER_ENABLED" && b.type === "plain_text" && b.text === "false"), "deployed_reader_not_off");
  requireCheck(bindings.some(b => b.name === "EGRESS_PROXY" && b.type === "vpc_service" && b.service_id === cfg.vpc_services[0].service_id), "deployed_vpc_mismatch");
  if (requireSecret) requireCheck(bindings.some(b => b.name === "EGRESS_PROXY_TOKEN" && b.type === "secret_text"), "deployed_secret_missing");
  const deployments = await api("workers/scripts/ai-command-center/deployments");
  const versions = deployments.deployments?.[0]?.versions;
  requireCheck(versions?.length === 1 && versions[0].percentage === 100, "single_active_version_unverified");
  console.log(`production_off_and_deployment_verified=true; secret_required=${requireSecret}`);
}

const probeName = `bor-egress-proof-${run}-${attempt}`;
const probeConfig = "tools/egress-proxy/runtime/wrangler.generated.json";
let probeMayExist = false;
let stage = "deploy_off_guard";
try {
  await cli(["deploy", "--config", "wrangler.jsonc", "--message", `egress-off-guard:${process.env.GITHUB_SHA}`]);
  stage = "verify_off_guard";
  await verifyProduction(false);
  stage = "install_production_secret";
  await cli(["secret", "put", "EGRESS_PROXY_TOKEN", "--config", "wrangler.jsonc"], token + "\n");
  stage = "verify_production_secret";
  await verifyProduction(true);
  console.log("production_secret_metadata=present; url_reader=OFF");
  fs.writeFileSync(probeConfig, JSON.stringify({
    name: probeName, main: "probe-worker.js", compatibility_date: cfg.compatibility_date,
    compatibility_flags: cfg.compatibility_flags, workers_dev: true,
    vpc_services: cfg.vpc_services, observability: { enabled: false }
  }));
  stage = "deploy_isolated_probe";
  probeMayExist = true;
  await cli(["deploy", "--config", probeConfig]);
  await cli(["secret", "put", "EGRESS_PROXY_TOKEN", "--config", probeConfig], token + "\n");
  stage = "probe_private_path";
  const subdomain = await api("workers/subdomain");
  requireCheck(/^[a-z0-9-]+$/.test(subdomain.subdomain || ""), "worker_subdomain_unverified");
  const endpoint = `https://${probeName}.${subdomain.subdomain}.workers.dev/run`;
  // A public caller cannot trigger the probe. It never accepts caller-provided targets.
  const denied = await fetch(endpoint, { method: "POST", signal: AbortSignal.timeout(20000), redirect: "error" });
  requireCheck(denied.status === 401, "probe_public_access_not_denied");
  await denied.body?.cancel();
  const response = await fetch(endpoint, { method: "POST", headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(90000), redirect: "error" });
  requireCheck(response.ok, "private_runtime_probe_failed");
  const proof = await response.json();
  requireCheck(proof.ok === true && proof.checks?.authenticationDenied === true && proof.checks?.unsafeDestinationsDenied === true && proof.checks?.productionAdapterPeerAndTlsVerified === true, "runtime_evidence_incomplete");
  console.log("worker_vpc_tunnel_proxy_runtime_proof=PASS; auth_denial=PASS; unsafe_ip_denial=PASS; peer_tls=PASS");
  console.log("url_reader=OFF; remaining_hosted_security_and_independent_privacy_gates=OPEN");
} catch {
  console.error(`egress_setup=FAILED; stage=${stage}; url_reader_activation=NOT_PERFORMED`);
  process.exitCode = 1;
} finally {
  if (probeMayExist) {
    try { await cli(["delete", "--force", "--config", probeConfig]); console.log("temporary_probe_deleted=true"); }
    catch { console.error("temporary_probe_cleanup=FAILED; remove the run-specific proof Worker"); process.exitCode = 1; }
  }
  fs.rmSync(probeConfig, { force: true });
}
