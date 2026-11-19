import {
  hasGitHubChatConnection,
  listGitHubRepositoriesForChat,
  listGitHubIssuesForChat,
  readGitHubFileForChat
} from "./github-oauth.js";
import { calculateProviderCostMicroUsd, parseUsdMicro } from "./credit-metering.js";
import { consumeUsage, usageDay } from "./daily-limits.js";

const GITHUB_TOOL_INTENT = /\b(github|git hub|repositories|repository|repos?|pull request|pull requests|pr|git branch|git commit)\b/i;
const GITHUB_TOOL_BUDGET_COUNTER = "provider:workers-ai:github-tools:global:micro-usd";
const GITHUB_TOOL_INPUT_RATE_MICRO_USD = 293_000n;
const GITHUB_TOOL_OUTPUT_RATE_MICRO_USD = 2_253_000n;

export const GITHUB_CHAT_TOOLS = Object.freeze([
  Object.freeze({
    name: "list_github_repositories",
    description: "List repositories available to the signed-in user's connected GitHub account. Use only when the user asks about their GitHub repositories or code.",
    parameters: Object.freeze({ type: "object", properties: Object.freeze({}), required: Object.freeze([]) })
  }),
  Object.freeze({
    name: "list_github_issues",
    description: "List open GitHub issues and pull requests from one repository available to the signed-in user's connected GitHub account.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({ repository: Object.freeze({ type: "string", description: "Repository full name, selected from list_github_repositories." }) }),
      required: Object.freeze(["repository"])
    })
  }),
  Object.freeze({
    name: "read_github_file",
    description: "Read a text file from a repository available to the signed-in user's connected GitHub account. Read-only. Never use for secrets, credentials, or files unrelated to the user's request.",
    parameters: Object.freeze({
      type: "object",
      properties: Object.freeze({
        repository: Object.freeze({ type: "string", description: "Repository full name, selected from list_github_repositories." }),
        path: Object.freeze({ type: "string", description: "A file path inside the repository." })
      }),
      required: Object.freeze(["repository", "path"])
    })
  })
]);

export function shouldOfferGitHubTools(userMessage, user, enabled) {
  return enabled === true && Boolean(user?.id) && GITHUB_TOOL_INTENT.test(String(userMessage || ""));
}

export async function availableGitHubTools(userMessage, user, env) {
  if (!shouldOfferGitHubTools(userMessage, user, env?.BOR_GITHUB_CHAT_TOOLS_ENABLED === "true")) return [];
  return await hasGitHubChatConnection(user, env) ? GITHUB_CHAT_TOOLS : [];
}

// Reserve for the follow-up model call before executing a user-scoped GitHub
// read. Byte length is used as a conservative token upper bound; the reserved
// amount remains spent if the provider outcome is ambiguous.
export async function reserveGitHubToolInferenceBudget(env, messages, maxOutputTokens, plannedActions = 1) {
  if (!env?.DB?.prepare || !Array.isArray(messages) ||
    !Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 2200 ||
    !Number.isSafeInteger(plannedActions) || plannedActions < 1 || plannedActions > 2) {
    return { allowed: false, reason: "invalid_or_unavailable" };
  }
  let limitMicroUsd;
  try {
    limitMicroUsd = parseUsdMicro(String(env.BOR_PLUGIN_TOOL_DAILY_USD_LIMIT ?? "0.10"));
  } catch {
    return { allowed: false, reason: "invalid_limit" };
  }
  if (limitMicroUsd <= 0n || limitMicroUsd > 1_000_000n) return { allowed: false, reason: "invalid_limit" };
  const inputBytes = new TextEncoder().encode(JSON.stringify(messages)).length;
  const schemaBytes = new TextEncoder().encode(JSON.stringify(GITHUB_CHAT_TOOLS)).length;
  const estimatedInputTokens = inputBytes + schemaBytes + 8192 + plannedActions * 36_000;
  if (estimatedInputTokens > 80_000) return { allowed: false, reason: "input_limit" };
  const reservedMicroUsd = calculateProviderCostMicroUsd({
    inputTokens: estimatedInputTokens,
    outputTokens: maxOutputTokens,
    inputRateMicroUsdPerMillion: GITHUB_TOOL_INPUT_RATE_MICRO_USD,
    outputRateMicroUsdPerMillion: GITHUB_TOOL_OUTPUT_RATE_MICRO_USD
  });
  if (reservedMicroUsd > BigInt(Number.MAX_SAFE_INTEGER)) return { allowed: false, reason: "input_limit" };
  try {
    const total = await consumeUsage(env, usageDay(), GITHUB_TOOL_BUDGET_COUNTER, Number(reservedMicroUsd), Number(limitMicroUsd));
    return total === null
      ? { allowed: false, reason: "daily_budget" }
      : { allowed: true, reservedMicroUsd: Number(reservedMicroUsd) };
  } catch {
    return { allowed: false, reason: "budget_unavailable" };
  }
}

export function pluginBudgetMessage(language = "en") {
  const copy = {
    en: "GitHub data was not opened because BOR AI reached its daily plugin budget. Try again tomorrow.",
    id: "Data GitHub tidak dibuka karena BOR AI mencapai batas biaya plugin harian. Coba lagi besok.",
    es: "No se abrió la información de GitHub porque BOR AI alcanzó el presupuesto diario de plugins. Inténtalo mañana.",
    fr: "Les données GitHub n’ont pas été ouvertes, car BOR AI a atteint son budget quotidien de plugins. Réessayez demain.",
    de: "GitHub-Daten wurden nicht geöffnet, da BOR AI das tägliche Plugin-Budget erreicht hat. Versuche es morgen erneut.",
    pt: "Os dados do GitHub não foram abertos porque o BOR AI atingiu o orçamento diário de plugins. Tente novamente amanhã.",
    ja: "BOR AIのプラグインの日額予算に達したため、GitHubデータは開きませんでした。明日もう一度お試しください。",
    ko: "BOR AI의 일일 플러그인 예산에 도달해 GitHub 데이터를 열지 않았습니다. 내일 다시 시도하세요.",
    zh: "BOR AI 已达到每日插件预算，因此未读取 GitHub 数据。请明天重试。",
    ar: "لم تُفتح بيانات GitHub لأن BOR AI بلغ ميزانية الإضافات اليومية. حاول مرة أخرى غدًا."
  };
  return copy[language] || copy.en;
}

function normalizeArguments(value) {
  if (typeof value === "string") {
    if (value.length > 4000) return null;
    try { value = JSON.parse(value); } catch { return null; }
  }
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

export async function executeGitHubChatTool(user, env, name, rawArguments) {
  const args = normalizeArguments(rawArguments);
  if (!args) return { error: "The plugin call had invalid arguments." };
  if (name === "list_github_repositories") return listGitHubRepositoriesForChat(user, env);
  if (name === "list_github_issues") return listGitHubIssuesForChat(user, env, args.repository);
  if (name === "read_github_file") return readGitHubFileForChat(user, env, args.repository, args.path);
  return { error: "That plugin action is not available." };
}

export function extractGitHubToolCalls(result) {
  const calls = result?.tool_calls ?? result?.result?.tool_calls ??
    result?.choices?.[0]?.message?.tool_calls ?? result?.result?.choices?.[0]?.message?.tool_calls;
  return Array.isArray(calls) ? calls : [];
}
