// Dedicated staging entrypoint; never imported by the production chat Worker.
// Install @cloudflare/playwright within staging/browser before a reviewed build.
import { launch } from "@cloudflare/playwright";
import { createBrowserStagingHandler } from "../../src/browser-staging-handler.js";

const handle = createBrowserStagingHandler({ launch });
export default { fetch: handle };
