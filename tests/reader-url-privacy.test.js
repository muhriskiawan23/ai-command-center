import test from "node:test";
import assert from "node:assert/strict";
import { checkPublicUrl } from "../src/reader-url-privacy.js";
import { createVerifiedLinkFetcher } from "../src/verified-egress.js";

const origin = "https://example.com";
for (const [path, expected] of [
  ["/article", true], ["/article#private-fragment", true],
  ["/reset-password/abc", false], ["/invite/abc", false],
  ["/oauth/callback", false], ["/verify-email/abc", false],
  ["/%2572eset-password/abc", false], ["/article?session=abc", false],
  ["/article?data=abc", false], ["/article?apiKey=abc", false],
  ["/eyJabcdefghijk.abcdefgh.abcdefgh", false]
]) {
  test("shared external reader privacy policy: " + path, () => {
    const result = checkPublicUrl(origin + path);
    assert.equal(result.ok, expected);
    if (result.ok) assert.equal(result.url.hash, "");
  });
}

for (const path of ["/reset-password/a", "/article?data=abc", "/invite/a"]) {
  test("Railway denies private URL before budget or transport: " + path, async () => {
    let dbCalls = 0, proxyCalls = 0;
    const reader = createVerifiedLinkFetcher({
      URL_READER_ENABLED: "true", URL_READER_PROVIDER: "railway",
      RAILWAY_READER_DAILY_HOP_LIMIT: "50",
      EGRESS_PROXY_TOKEN: "synthetic-fixture-not-real-credential-123456",
      DB: { prepare() { dbCalls++; throw new Error("unexpected"); } },
      EGRESS_PROXY: { async fetch() { proxyCalls++; throw new Error("unexpected"); } }
    });
    await assert.rejects(() => reader(origin + path), /proxy_url_disallowed/);
    assert.equal(dbCalls, 0);
    assert.equal(proxyCalls, 0);
  });
}
