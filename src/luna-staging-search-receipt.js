// Metadata-only receipt for an isolated staging request. Never persist raw provider bodies.
const tokenCount = n => Number.isSafeInteger(n) && n >= 0;
export function stagingSearchReceipt(response, data) {
  const id = response.headers.get("x-request-id");
  const requestId = typeof id === "string" && /^req_[A-Za-z0-9_-]{1,128}$/.test(id) ? id : null;
  const u = data?.usage;
  const input = u?.input_tokens, output = u?.output_tokens;
  const cached = u?.input_tokens_details?.cached_tokens ?? 0;
  const reasoning = u?.output_tokens_details?.reasoning_tokens ?? 0;
  const model = typeof data?.model === "string" && /^gpt-6-luna(?:-\d{4}-\d{2}-\d{2})?$/.test(data.model) ? data.model : null;
  const webCalls = Array.isArray(data?.output) ? data.output.filter(item => item?.type === "web_search_call").length : null;
  const usage = [input, output, cached, reasoning, webCalls].every(tokenCount) && cached <= input && reasoning <= output
    ? { input, output, cached, reasoning, webCalls } : null;
  const billedWebRequests = data?.tool_usage?.web_search?.num_requests;
  if (usage && tokenCount(billedWebRequests)) usage.billedWebRequests = billedWebRequests;
  return { httpStatus: response.status, requestId, model, usage,
    completed: data?.status === "completed", reconciliationRequired: true };
}
