import { readFileSync } from "node:fs";

const model = "gpt-6-luna";
const campaignLimitMicroUsd = 500_000;
const textReservationMicroUsd = 40_000;
const searchReservationMicroUsd = 260_000;
const inputTokenLimit = 10_000;
const expected = [
  ["compact-id", "chat", 1],
  ["arithmetic-id", "chat", 1],
  ["context-id", "chat", 2],
  ["code-en", "chat", 1],
  ["evidence-id", "chat", 1],
  ["bennu-id", "web_search", 1]
];

const fixtureUrl = new URL("./answer-quality-smoke.json", import.meta.url);
const { cases } = JSON.parse(readFileSync(fixtureUrl, "utf8"));
if (!Array.isArray(cases) || cases.length !== expected.length) {
  throw new Error("Unexpected number of benchmark cases");
}

const steps = cases.flatMap(({ id, route, turns }, index) => {
  const [expectedId, expectedRoute, turnCount] = expected[index];
  if (id !== expectedId || route !== expectedRoute ||
      !Array.isArray(turns) || turns.length !== turnCount ||
      turns.some(turn => typeof turn !== "string" || !turn.trim())) {
    throw new Error(`Unexpected benchmark case at position ${index + 1}`);
  }

  const search = route === "web_search";
  return turns.map((content, turn) => ({
    id: `${id}:${turn + 1}`,
    route,
    requiresPriorTurn: turn > 0 ? `${id}:${turn}` : null,
    inputTokenLimit,
    reserveMicroUsd: search ? searchReservationMicroUsd : textReservationMicroUsd,
    request: {
      model,
      input: [{ role: "user", content }],
      store: false,
      truncation: "disabled",
      reasoning: { effort: "low" },
      max_output_tokens: search ? 2400 : id === "compact-id" ? 128 : 1400,
      ...(search ? {
        tools: [{ type: "web_search" }],
        tool_choice: { type: "web_search" },
        max_tool_calls: 1,
        include: ["web_search_call.action.sources"]
      } : {})
    }
  }));
});

const total = steps.reduce((sum, step) => sum + step.reserveMicroUsd, 0);
if (steps.length !== 7 || total !== campaignLimitMicroUsd) {
  throw new Error("Benchmark reservation does not match the approved campaign");
}

process.stdout.write(JSON.stringify({
  schema: 1,
  mode: "model-only",
  endpoint: "https://api.openai.com/v1/responses",
  tokenCountEndpoint: "https://api.openai.com/v1/responses/input_tokens",
  reservationMicroUsd: total,
  maxResponseRequests: steps.length,
  maxSearchResponseRequests: 1,
  allowRetry: false,
  steps
}, null, 2) + "\n");
