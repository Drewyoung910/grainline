import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

const { reviewListingWithAI } = await import("../src/lib/ai-review.ts");

const originalOpenAIKey = process.env.OPENAI_API_KEY;

afterEach(() => {
  if (originalOpenAIKey == null) {
    delete process.env.OPENAI_API_KEY;
  } else {
    process.env.OPENAI_API_KEY = originalOpenAIKey;
  }
});

function listing() {
  return {
    sellerId: "seller_1",
    title: "Walnut entry bench",
    description: "Handmade walnut entry bench with tapered legs and oil finish.",
    priceCents: 45000,
    category: "FURNITURE",
    tags: ["walnut", "bench"],
    sellerName: "North Grain",
    listingCount: 3,
    imageUrls: ["https://cdn.example.invalid/listing.jpg"],
  };
}

function assertFailClosed(result) {
  assert.equal(result.approved, false);
  assert.equal(result.confidence, 0);
  assert.ok(result.flags.length > 0);
  assert.equal(Array.isArray(result.altTexts), true);
  assert.deepEqual(result.altTexts, []);
}

describe("AI review outer fail-closed behavior", () => {
  it("fails closed before DB or network work when the OpenAI key is missing", async () => {
    delete process.env.OPENAI_API_KEY;

    const result = await reviewListingWithAI(listing(), {
      findRecentListingTitles: async () => {
        throw new Error("duplicate lookup should not run without OpenAI config");
      },
      fetchWithTimeout: async () => {
        throw new Error("network should not run without OpenAI config");
      },
    });

    assertFailClosed(result);
    assert.match(result.flags.join(" "), /missing API key/);
  });

  it("fails closed when the provider returns malformed model content", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const result = await reviewListingWithAI(listing(), {
      findRecentListingTitles: async () => [],
      fetchWithTimeout: async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: "not-json" } }] }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      sleep: async () => {},
    });

    assertFailClosed(result);
    assert.match(result.reason, /AI review error/);
  });

  it("retries transient provider failures once and then fails closed", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let calls = 0;

    const result = await reviewListingWithAI(listing(), {
      findRecentListingTitles: async () => [],
      fetchWithTimeout: async () => {
        calls += 1;
        return new Response("{}", { status: 503 });
      },
      sleep: async () => {},
    });

    assert.equal(calls, 2);
    assertFailClosed(result);
  });

  it("formats prompt prices through the shared currency formatter", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let requestBody;

    await reviewListingWithAI({ ...listing(), currency: "eur" }, {
      findRecentListingTitles: async () => [],
      fetchWithTimeout: async (_url, init) => {
        requestBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                approved: false,
                flags: ["low-quality-description"],
                confidence: 0.6,
                reason: "Manual review",
                altTexts: [],
              }),
            },
          }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      sleep: async () => {},
    });

    const prompt = requestBody.messages[1].content[0].text;
    assert.match(prompt, /€450\.00/);
    assert.doesNotMatch(prompt, /\$450\.00/);
  });

  it("keeps the moderation prompt aligned with the US-only marketplace scope", async () => {
    process.env.OPENAI_API_KEY = "test-key";
    let requestBody;

    await reviewListingWithAI(listing(), {
      findRecentListingTitles: async () => [],
      fetchWithTimeout: async (_url, init) => {
        requestBody = JSON.parse(init.body);
        return new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                approved: false,
                flags: ["low-quality-description"],
                confidence: 0.6,
                reason: "Manual review",
                altTexts: [],
              }),
            },
          }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      sleep: async () => {},
    });

    const systemPrompt = requestBody.messages[0].content;
    assert.match(systemPrompt, /marketplace serving the United States/);
    assert.doesNotMatch(systemPrompt, /US and Canada|United States and Canada/);
  });

  it("does not count the listing currently under review as a prior duplicate", async () => {
    process.env.OPENAI_API_KEY = "test-key";

    const result = await reviewListingWithAI({ ...listing(), listingId: "listing_current" }, {
      findRecentListingTitles: async (_sellerId, excludeListingId) => {
        assert.equal(excludeListingId, "listing_current");
        return [
          { id: "listing_prior", title: "Walnut entry bench" },
          { id: "listing_current", title: "Walnut entry bench" },
        ].filter((row) => row.id !== excludeListingId);
      },
      fetchWithTimeout: async () =>
        new Response(JSON.stringify({
          choices: [{
            message: {
              content: JSON.stringify({
                approved: true,
                flags: [],
                confidence: 0.92,
                reason: "Looks good",
                altTexts: [],
              }),
            },
          }],
        }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      sleep: async () => {},
    });

    assert.equal(result.approved, true);
    assert.deepEqual(result.flags, []);
  });
});
