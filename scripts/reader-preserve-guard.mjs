// Preserve ONLY a verified, already-running Tavily Reader during an explicitly
// approved production release. This is not permission to activate new egress.
// The caller obtains bindings from Cloudflare's authenticated ACTIVE 100%-traffic
// Worker version, never from client requests or GitHub guesswork.
const named = (bindings, name) => bindings.filter(item => item?.name === name);
function activeText(bindings, name) {
  const entries = named(bindings, name);
  if (entries.length !== 1 || entries[0].type !== 'plain_text' ||
      typeof entries[0].text !== 'string') throw Error('Active Reader release guard: missing or ambiguous '+name);
  return entries[0].text;
}

export function buildPreservedTavilyReaderConfig(config, bindings) {
  if (!Array.isArray(bindings) || !config || config.name !== 'ai-command-center' ||
      !config.vars || config.vars.URL_READER_ENABLED !== 'false' ||
      config.vars.URL_READER_PROVIDER !== 'tavily' ||
      config.vars.TAVILY_EXTRACT_DAILY_URL_LIMIT !== '0')
    throw Error('Candidate baseline must be the reviewed URL Reader OFF configuration');
  if (activeText(bindings, 'URL_READER_ENABLED') !== 'true')
    throw Error('Active URL Reader must already be ON; refusing a new activation');
  if (activeText(bindings, 'URL_READER_PROVIDER') !== 'tavily')
    throw Error('Only the existing managed Tavily Reader may be preserved');
  const rawQuota = activeText(bindings, 'TAVILY_EXTRACT_DAILY_URL_LIMIT');
  if (!/^[1-9][0-9]?$/.test(rawQuota) || Number(rawQuota) > 8)
    throw Error('Active Tavily Extract quota must be a positive integer at most 8 URLs per day');
  const keys = named(bindings, 'TAVILY_API_KEY');
  // Do not read or log a credential; attestation is by binding name and type only.
  if (keys.length !== 1 || keys[0].type !== 'secret_text')
    throw Error('Active Tavily API secret binding is not verifiable by name/type');
  const copy = JSON.parse(JSON.stringify(config));
  copy.vars.URL_READER_ENABLED = 'true';
  copy.vars.URL_READER_PROVIDER = 'tavily';
  copy.vars.TAVILY_EXTRACT_DAILY_URL_LIMIT = rawQuota;
  // Search and first-party assets remain the reviewed baseline; no new egress
  // binding, payment, image generation, browser automation or database resource.
  if (copy.vars.BOR_IMAGES_ENABLED !== 'false')
    throw Error('Reader preservation cannot coincide with paid image activation');
  return { config: copy, urlBudget: Number(rawQuota) };
}
