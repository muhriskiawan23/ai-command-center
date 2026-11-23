// Build an opt-in, production-only config for the isolated billing status shadow.
// The checked-in Wrangler config remains OFF, so PR previews never receive this D1 binding.
import fs from "node:fs";

const source = process.env.BOR_DEPLOY_CONFIG || "wrangler.jsonc";
const output = "wrangler.billing-shadow.generated.jsonc";
const rawDatabaseId = process.env.BOR_BILLING_SHADOW_D1_ID;
const databaseName = "bor-ai-billing-shadow";
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(rawDatabaseId || "") ||
    /^0{8}-0{4}-0{4}-0{4}-0{12}$/.test(rawDatabaseId)) {
  throw new Error("A valid isolated billing shadow D1 database ID is required.");
}
const databaseId = rawDatabaseId.toLowerCase();
if (!process.env.GITHUB_ENV) throw new Error("GitHub Actions environment file is unavailable.");
const config = JSON.parse(fs.readFileSync(source, "utf8"));
if (config.name !== "ai-command-center") throw new Error("Unexpected production Worker.");
const chat = config.d1_databases?.find((binding) => binding.binding === "DB");
if (!chat?.database_id || chat.database_name !== "bor-ai-chat") {
  throw new Error("The production chat D1 binding must remain pinned to bor-ai-chat.");
}
if (chat.database_id.toLowerCase() === databaseId) {
  throw new Error("The billing shadow D1 must never reuse the production chat database.");
}
const existing = config.d1_databases?.find((binding) => binding.binding === "BILLING_SHADOW_DB");
if (existing && (existing.database_id !== databaseId || existing.database_name !== databaseName)) {
  throw new Error("Refusing to replace a different billing shadow database binding.");
}
config.d1_databases ??= [];
if (!existing) {
  config.d1_databases.push({
    binding: "BILLING_SHADOW_DB",
    database_name: databaseName,
    database_id: databaseId
  });
}
config.vars ??= {};
Object.assign(config.vars, {
  BOR_BILLING_SHADOW_ENABLED: "true",
  BOR_BILLING_SHADOW_D1_NAME: databaseName
});
fs.writeFileSync(output, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
fs.appendFileSync(process.env.GITHUB_ENV, "BOR_DEPLOY_CONFIG=" + output + "\n");
console.log("Prepared opt-in production-only billing shadow config; checked-in and preview configs remain unchanged.");
