import { serverPdfConversionAllowed } from "./runtime-security-policy.js";
import { imageConfig } from "./image-jobs.js";
import { isSearchProviderConfigured } from "./research.js";

const FILE_FORMATS = Object.freeze(["PDF", "DOCX", "XLSX", "PPTX", "CSV", "JPG", "PNG", "WEBP"]);

// Public, secret-free feature state for the Plugins catalog. A listed capability
// describes a real BOR AI path; it does not imply a third-party plugin marketplace.
export function pluginCapabilities(env = {}) {
  const images = imageConfig(env);
  const githubConfigured = Boolean(env.DB && env.GITHUB_APP_CLIENT_ID && env.GITHUB_APP_CLIENT_SECRET &&
    env.GITHUB_APP_REDIRECT_URI && env.GITHUB_TOKEN_ENCRYPTION_KEY);
  const githubChatEnabled = githubConfigured && env.BOR_GITHUB_CHAT_TOOLS_ENABLED === "true";
  // Configuration only: an enabled path is not proof that a real third-party URL is readable.
  // Do not expose credentials, URLs, billing account details or network bindings in this endpoint.
  const readerEnabled = env.URL_READER_ENABLED === "true";
  const extractLimit = env.TAVILY_EXTRACT_DAILY_URL_LIMIT;
  const validExtractLimit = (typeof extractLimit === "string" && /^[0-9]+$/.test(extractLimit.trim())) || Number.isSafeInteger(extractLimit);
  const extractBudgetReady = validExtractLimit && Number(extractLimit) >= 1 && Number(extractLimit) <= 10000;
  const managedReaderReady = readerEnabled && env.URL_READER_PROVIDER === "tavily" &&
    typeof env.TAVILY_API_KEY === "string" && Boolean(env.TAVILY_API_KEY.trim()) &&
    Boolean(env.DB?.prepare) && extractBudgetReady;
  const pinnedProxyReady = readerEnabled && env.URL_READER_PROVIDER !== "tavily" &&
    typeof env.EGRESS_PROXY?.fetch === "function" &&
    typeof env.EGRESS_PROXY_TOKEN === "string" && env.EGRESS_PROXY_TOKEN.length >= 32;
  return {
    version: 1,
    tools: {
      webSearch: {
        available: isSearchProviderConfigured(env),
        invocation: "automatic",
        scope: "search_result_snippets"
      },
      webReading: {
        // Config readiness, not an attestation of upstream SSRF/redirect safety or live uptime.
        available: Boolean(managedReaderReady || pinnedProxyReady),
        enabled: readerEnabled,
        scope: "public_http_links",
        maxLinksPerMessage: 3,
        invocation: "user_url_or_search_result",
        externallyVerified: false
      },
      webActions: {
        available: false,
        scope: "general_browser_interaction",
        requiresUserApproval: true
      },
      fileAnalysis: {
        available: true,
        formats: FILE_FORMATS,
        pdfLocalExtraction: true,
        pdfServerConversion: serverPdfConversionAllowed(env,new URL("https://app.getborai.com")),
        imageVision: env.BOR_VISION_ENABLED === "true"
      },
      imageGeneration: {
        available: images.enabled,
        credits: images.credits,
        tariffVersion: images.tariffVersion
      },
      emailDrafts: {
        available: true,
        connectedAccount: false,
        sendsEmail: false
      },
      github: {
        available: githubConfigured,
        repositoryBrowser: true,
        inChatActions: githubChatEnabled,
        chatTools: githubChatEnabled
          ? ["list_github_repositories", "list_github_issues", "read_github_file"]
          : [],
        writes: false
      }
    }
  };
}
