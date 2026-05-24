import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { isLikelyBotUserAgent } = await import("../src/lib/botUserAgent.ts");

describe("bot user-agent classification", () => {
  it("treats missing or blank user agents as non-human analytics traffic", () => {
    assert.equal(isLikelyBotUserAgent(null), true);
    assert.equal(isLikelyBotUserAgent(undefined), true);
    assert.equal(isLikelyBotUserAgent("   "), true);
  });

  it("filters common scraper and non-browser clients", () => {
    for (const userAgent of [
      "curl/8.4.0",
      "Wget/1.21.4",
      "python-requests/2.31.0",
      "Go-http-client/2.0",
      "axios/1.6.0",
      "node-fetch",
      "undici",
      "Scrapy/2.11",
      "PostmanRuntime/7.37.0",
      "okhttp/4.12.0",
      "Googlebot/2.1",
      "facebookexternalhit/1.1",
    ]) {
      assert.equal(isLikelyBotUserAgent(userAgent), true, userAgent);
    }
  });

  it("does not classify ordinary browser user agents as likely bots", () => {
    assert.equal(
      isLikelyBotUserAgent(
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_6) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36",
      ),
      false,
    );
  });
});
