// Never return raw CLI text, paths, identifiers, URLs or credentials.
export function summarizeCliFailure(output, secrets = []) {
  let safe = String(output);
  for (const secret of secrets.filter(Boolean)) safe = safe.split(secret).join("[redacted]");
  safe = safe.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, "");
  const lower = safe.toLowerCase();
  const codes = [...new Set([...safe.matchAll(/\bcode["\']?\s*:\s*(\d{3,6})\b/gi)].map(m => Number(m[1])))].slice(0, 5);
  const categories = [
    ["authorization", /unauthorized|forbidden|authentication error|permission|not authorized|insufficient scope|not permitted|access denied|not allowed/],
    ["cli_arguments", /unknown argument|unknown option|unrecognized option/],
    ["vpc", /vpc|virtual private/],
    ["binding", /binding/],
    ["assets", /asset/],
    ["asset_response_invalid", /unexpected response|missing completion token|could not find assets information/],
    ["asset_upload_incomplete", /failed to complete asset upload/],
    ["http_401", /\b401\b/],
    ["http_403", /\b403\b/],
    ["http_404", /\b404\b/],
    ["http_5xx", /\b50[0-9]\b|internal server error/],
    ["invalid_token", /invalid.*token|token.*invalid/],
    ["unsupported_token", /account.owned|user.owned|global api key/],
    ["invalid_header", /invalid header/],
    ["network", /fetch failed|failed to fetch|fetch\(\) failed|timeout|timed out|enotfound|econn/],
    ["confirmation", /non.interactive|confirmation|confirm|prompt/],
    ["build", /build failed|could not resolve|syntaxerror/],
    ["version", /version|deployment/]
  ].filter(([, pattern]) => pattern.test(lower)).map(([name]) => name);
  return { codes, categories: categories.length ? categories : ["unknown"] };
}
