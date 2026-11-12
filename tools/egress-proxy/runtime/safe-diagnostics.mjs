// Never return raw CLI text, paths, identifiers, URLs or credentials.
export function summarizeCliFailure(output, secrets = []) {
  let safe = String(output);
  for (const secret of secrets.filter(Boolean)) safe = safe.split(secret).join("[redacted]");
  const lower = safe.toLowerCase();
  const codes = [...new Set([...safe.matchAll(/\bcode:\s*(\d{3,6})\b/gi)].map(m => Number(m[1])))].slice(0, 5);
  const categories = [
    ["authorization", /unauthorized|forbidden|authentication error|permission|not authorized|insufficient scope/],
    ["cli_arguments", /unknown argument|unknown option|unrecognized option/],
    ["vpc", /vpc|virtual private/],
    ["binding", /binding/],
    ["assets", /asset/],
    ["network", /fetch failed|timeout|timed out|enotfound|econn/],
    ["confirmation", /non.interactive|confirmation|confirm|prompt/],
    ["build", /build failed|could not resolve|syntaxerror/],
    ["version", /version|deployment/]
  ].filter(([, pattern]) => pattern.test(lower)).map(([name]) => name);
  return { codes, categories: categories.length ? categories : ["unknown"] };
}
