import { readFileSync, writeFileSync } from "node:fs";

const [, , databaseId, ...options] = process.argv;
if (options.length && (options.length !== 2 || options[0] !== "--vpc-service" ||
  !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(options[1]))) {
  throw new Error("Optional syntax: --vpc-service <existing private HTTP service UUID>");
}
const source = JSON.parse(readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8"));
if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(databaseId ?? "") ||
  source.d1_databases.some(entry => entry.database_id.toLowerCase() === databaseId.toLowerCase())) {
  throw new Error("Supply the isolated bor-ai-luna-staging D1 database UUID");
}
const config = {
  name: "bor-ai-luna-staging",
  main: "src/luna-staging-worker.js",
  compatibility_date: source.compatibility_date,
  compatibility_flags: source.compatibility_flags,
  workers_dev: true,
  preview_urls: false,
  ai: { binding: "AI" },
  d1_databases: [{ binding: "DB", database_name: "bor-ai-luna-staging", database_id: databaseId }],
  ...(options.length ? { vpc_services: [{ binding: "EGRESS_PROXY", service_id: options[1] }] } : {})
};
writeFileSync(new URL("../wrangler.luna-staging.generated.jsonc", import.meta.url), JSON.stringify(config, null, 2) + "\n");
