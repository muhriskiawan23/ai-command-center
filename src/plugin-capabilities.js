import { searchMode, searchV2Configured } from "./web-search-v2.js";
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
  const mode = searchMode(env);
  return {
    version: 1,
    tools: {
      webSearch: {
        available: mode !== "off" && (isSearchProviderConfigured(env) || searchV2Configured(env, false)),
        invocation: "automatic"
      },
      fileAnalysis: {
        available: true,
        formats: FILE_FORMATS,
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
