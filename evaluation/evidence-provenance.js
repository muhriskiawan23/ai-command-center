import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify
} from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

const SCHEMA_VERSION = "1.0.0";
const DOMAIN = "BOR-AI-EVALUATION-EVIDENCE-V1\n";
const EXECUTION_TYPES = new Set(["manual_live", "manual_mocked"]);
const RUN_STATUSES = new Set(["completed", "failed", "skipped"]);

function canonicalValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("evidence contains a non-finite number");
    return value;
  }
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("evidence must contain only JSON-compatible values");
  }
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalValue(value[key])]));
}

export function canonicalJson(value) {
  return JSON.stringify(canonicalValue(value));
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function keyFingerprint(publicKey) {
  const key = publicKey?.type === "public" ? publicKey : createPublicKey(publicKey);
  return sha256(key.export({ type: "spki", format: "der" })).slice(0, 32);
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function validTimestamp(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function validateEvidencePayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload) ||
      !Array.isArray(payload.runs) || !Array.isArray(payload.scoreDimensions) ||
      payload.scoreDimensions.length === 0 ||
      payload.scoreDimensions.some((dimension) => !nonEmpty(dimension)) ||
      new Set(payload.scoreDimensions).size !== payload.scoreDimensions.length) {
    throw new TypeError("evidence payload must be an evaluation plan with unique scoreDimensions and runs");
  }
  const models = new Map();
  const roles = new Map();
  const seen = new Set();
  for (const [index, run] of payload.runs.entries()) {
    const label = `runs[${index}]`;
    if (!run || typeof run !== "object" || Array.isArray(run) ||
        !RUN_STATUSES.has(run.status)) {
      throw new TypeError(`${label}.status must be completed, failed, or skipped before signing`);
    }
    for (const field of ["modelId", "modelRole", "caseId", "language", "task"]) {
      if (!nonEmpty(run[field])) throw new TypeError(`${label}.${field} must be a non-empty string`);
    }
    if (!["baseline", "candidate"].includes(run.modelRole)) {
      throw new TypeError(`${label}.modelRole must be baseline or candidate`);
    }
    if (roles.has(run.modelId) && roles.get(run.modelId) !== run.modelRole) {
      throw new TypeError(`model ${run.modelId} has inconsistent modelRole values`);
    }
    roles.set(run.modelId, run.modelRole);
    if (!Number.isSafeInteger(run.runIndex) || run.runIndex < 1) {
      throw new TypeError(`${label}.runIndex must be a positive safe integer`);
    }
    const runKey = JSON.stringify([run.modelId, run.caseId, run.runIndex]);
    if (seen.has(runKey)) throw new TypeError(`${label} duplicates an evaluation run`);
    seen.add(runKey);
    if (!run.scores || typeof run.scores !== "object" || Array.isArray(run.scores)) {
      throw new TypeError(`${label}.scores must be an object`);
    }
    for (const dimension of payload.scoreDimensions) {
      const score = run.scores[dimension];
      if (score !== null && (!Number.isInteger(score) || score < 1 || score > 5)) {
        throw new TypeError(`${label}.scores.${dimension} must be null or an integer from 1 to 5`);
      }
    }
    if (run.criticalSafetyFailure !== null && typeof run.criticalSafetyFailure !== "boolean") {
      throw new TypeError(`${label}.criticalSafetyFailure must be boolean or null`);
    }
    for (const field of ["latencyMs", "costUsd"]) {
      if (run[field] !== null && (!Number.isFinite(run[field]) || run[field] < 0)) {
        throw new TypeError(`${label}.${field} must be null or a non-negative finite number`);
      }
    }
    for (const field of ["inputTokens", "outputTokens"]) {
      if (run[field] !== null && (!Number.isSafeInteger(run[field]) || run[field] < 0)) {
        throw new TypeError(`${label}.${field} must be null or a non-negative safe integer`);
      }
    }
    if (run.status === "failed" && !nonEmpty(run.failureReason)) {
      throw new TypeError(`${label}.failureReason is required for failed runs`);
    }
    if (run.status !== "completed") continue;
    if (!EXECUTION_TYPES.has(run.executionType)) {
      throw new TypeError(`${label}.executionType must be manual_live or manual_mocked`);
    }
    if (run.actualModelId !== run.modelId) {
      throw new TypeError(`${label}.actualModelId must match modelId`);
    }
    for (const field of ["actualModelId", "actualModelVersion", "provider", "policyVersion"]) {
      if (!nonEmpty(run[field])) throw new TypeError(`${label}.${field} is required for completed evidence`);
    }
    if (!validTimestamp(run.startedAt) || !validTimestamp(run.completedAt) ||
        Date.parse(run.completedAt) < Date.parse(run.startedAt)) {
      throw new TypeError(`${label} must have valid chronological start/completion timestamps`);
    }
    if (!nonEmpty(run.modelOutput)) {
      throw new TypeError(`${label}.modelOutput is required for completed evidence`);
    }
    if (!Number.isFinite(run.latencyMs) || run.latencyMs < 0) {
      throw new TypeError(`${label}.latencyMs is required for completed evidence`);
    }
    const identity = [run.actualModelId, run.actualModelVersion, run.provider, run.policyVersion];
    const previous = models.get(run.modelId);
    if (previous && identity.some((value, position) => value !== previous[position])) {
      throw new TypeError(`model ${run.modelId} has mixed model/provider/policy provenance`);
    }
    models.set(run.modelId, identity);
  }
  if (![...payload.runs].some((run) => run.modelRole === "baseline")) {
    throw new TypeError("evidence must include a baseline model");
  }
  if (![...payload.runs].some((run) => run.modelRole === "candidate")) {
    throw new TypeError("evidence must include at least one candidate model");
  }
  return {
    runCount: payload.runs.length,
    completedRuns: payload.runs.filter((run) => run.status === "completed").length,
    failedRuns: payload.runs.filter((run) => run.status === "failed").length,
    skippedRuns: payload.runs.filter((run) => run.status === "skipped").length,
    modelCount: new Set(payload.runs.map((run) => run.modelId)).size,
    evidenceTypes: [...new Set(payload.runs.filter((run) => run.status === "completed").map((run) => run.executionType))].sort()
  };
}

export function createEvidenceEnvelope(payload, privateKeyPem, { signedAt = new Date().toISOString() } = {}) {
  const summary = validateEvidencePayload(payload);
  if (typeof signedAt !== "string" || !Number.isFinite(Date.parse(signedAt))) {
    throw new TypeError("signedAt must be a valid timestamp");
  }
  const privateKey = privateKeyPem?.type === "private" ? privateKeyPem : createPrivateKey(privateKeyPem);
  if (privateKey.asymmetricKeyType !== "ed25519") throw new TypeError("signing key must be Ed25519");
  const publicKey = createPublicKey(privateKey);
  const payloadSnapshot = JSON.parse(canonicalJson(payload));
  const payloadJson = canonicalJson(payloadSnapshot);
  const unsigned = {
    schemaVersion: SCHEMA_VERSION,
    algorithm: "Ed25519",
    keyId: keyFingerprint(publicKey),
    signedAt,
    attestationType: "operator_signed_evaluation_record",
    payloadSha256: sha256(payloadJson),
    payload: payloadSnapshot,
    summary
  };
  const signature = sign(null, Buffer.from(DOMAIN + canonicalJson(unsigned)), privateKey).toString("base64");
  return { ...unsigned, signature };
}

export function verifyEvidenceEnvelope(envelope, trustedPublicKeyPem) {
  if (!envelope || typeof envelope !== "object" || Array.isArray(envelope) ||
      envelope.schemaVersion !== SCHEMA_VERSION || envelope.algorithm !== "Ed25519" ||
      typeof envelope.signedAt !== "string" || !Number.isFinite(Date.parse(envelope.signedAt)) ||
      envelope.attestationType !== "operator_signed_evaluation_record" ||
      typeof envelope.signature !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature)) {
    throw new TypeError("evidence envelope schema or signature encoding is invalid");
  }
  const publicKey = trustedPublicKeyPem?.type === "public" ? trustedPublicKeyPem : createPublicKey(trustedPublicKeyPem);
  if (publicKey.asymmetricKeyType !== "ed25519") throw new TypeError("trusted public key must be Ed25519");
  const keyId = keyFingerprint(publicKey);
  if (envelope.keyId !== keyId) throw new Error("trusted public key fingerprint does not match envelope keyId");
  const summary = validateEvidencePayload(envelope.payload);
  if (canonicalJson(envelope.summary) !== canonicalJson(summary)) {
    throw new Error("evidence summary mismatch");
  }
  const payloadHash = sha256(canonicalJson(envelope.payload));
  if (envelope.payloadSha256 !== payloadHash) throw new Error("evidence payload hash mismatch");
  const { signature, ...unsigned } = envelope;
  if (!verify(null, Buffer.from(DOMAIN + canonicalJson(unsigned)), publicKey, Buffer.from(signature, "base64"))) {
    throw new Error("evidence signature verification failed");
  }
  return { valid: true, schemaVersion: envelope.schemaVersion, algorithm: envelope.algorithm,
    keyId, signedAt: envelope.signedAt, payloadSha256: payloadHash, summary };
}

async function main(args) {
  const [command, ...values] = args;
  if (command === "keygen" && values.length === 2) {
    const [privatePath, publicPath] = values;
    if (resolve(privatePath) === resolve(publicPath)) throw new TypeError("private and public key paths must differ");
    const pair = generateKeyPairSync("ed25519");
    const privatePem = pair.privateKey.export({ type: "pkcs8", format: "pem" });
    const publicPem = pair.publicKey.export({ type: "spki", format: "pem" });
    await writeFile(publicPath, publicPem, { flag: "wx", mode: 0o644 });
    try {
      await writeFile(privatePath, privatePem, { flag: "wx", mode: 0o600 });
    } catch (error) {
      const { rm } = await import("node:fs/promises");
      await rm(publicPath, { force: true });
      throw error;
    }
    process.stdout.write(`Created Ed25519 key pair. Key ID: ${keyFingerprint(pair.publicKey)}\nKeep the private key offline and never commit it.\n`);
    return;
  }
  if (command === "sign" && values.length === 3) {
    const [planPath, envelopePath, privatePath] = values;
    const payload = JSON.parse(await readFile(planPath, "utf8"));
    const privatePem = await readFile(privatePath, "utf8");
    const envelope = createEvidenceEnvelope(payload, privatePem);
    await writeFile(envelopePath, `${JSON.stringify(envelope, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    process.stdout.write(`Signed ${envelope.summary.completedRuns}/${envelope.summary.runCount} evaluation runs. Envelope: ${envelopePath}\n`);
    return;
  }
  if (command === "verify" && values.length === 2) {
    const [envelopePath, publicPath] = values;
    const envelope = JSON.parse(await readFile(envelopePath, "utf8"));
    const publicPem = await readFile(publicPath, "utf8");
    const result = verifyEvidenceEnvelope(envelope, publicPem);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write("Usage:\n  node evaluation/evidence-provenance.js keygen private-key.pem public-key.pem\n  node evaluation/evidence-provenance.js sign completed-plan.json signed-evidence.json private-key.pem\n  node evaluation/evidence-provenance.js verify signed-evidence.json trusted-public-key.pem\n");
  process.exitCode = 1;
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`Evidence provenance failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}
