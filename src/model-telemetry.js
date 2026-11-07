export function createModelCallTelemetry({
  requestId,
  agentId,
  taskProfile,
  provider,
  adapter,
  modelId,
  policyVersion,
  attempt,
  startedAt,
  finishedAt,
  outcome,
  result,
  error
}) {
  const event = {
    event: "borai.model_call",
    schemaVersion: 1,
    requestId,
    agentId,
    taskProfile,
    provider,
    adapter,
    modelId,
    policyVersion,
    attempt,
    latencyMs: Math.max(0, Math.round(finishedAt - startedAt)),
    outcome
  };

  const usage = result?.usage ?? result?.result?.usage;
  if (usage && typeof usage === "object" && !Array.isArray(usage)) {
    const aliases = {
      promptTokens: ["prompt_tokens", "input_tokens", "promptTokens", "inputTokens"],
      completionTokens: ["completion_tokens", "output_tokens", "completionTokens", "outputTokens"],
      totalTokens: ["total_tokens", "totalTokens"]
    };
    for (const [field, keys] of Object.entries(aliases)) {
      const value = keys.map((key) => usage[key]).find((item) =>
        Number.isSafeInteger(item) && item >= 0
      );
      if (value !== undefined) event[field] = value;
    }
  }

  if (outcome === "error") {
    const name = typeof error?.name === "string" ? error.name : "Error";
    event.errorType = name.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 64) || "Error";
  }

  return event;
}

export function emitModelCallTelemetry(event, logger = console.log) {
  if (typeof logger !== "function") return;
  try {
    logger(event);
  } catch {
    // Telemetry must never break or delay the user's model response.
  }
}
