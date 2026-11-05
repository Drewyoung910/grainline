import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import path from "node:path";
import { describe, it } from "node:test";
import { pathToFileURL } from "node:url";

registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier.startsWith("@/")) {
      const relative = specifier.slice(2);
      const filePath = path.join(
        process.cwd(),
        "src",
        relative.endsWith(".ts") ? relative : `${relative}.ts`,
      );
      return nextResolve(pathToFileURL(filePath).href, context);
    }
    return nextResolve(specifier, context);
  },
});

const email = await import("../src/lib/email.ts");

describe("names with an ampersand or apostrophe", () => {
  // Shop names reach email as stored: sanitize-html wrote "&" as "&amp;".
  const stored = "O'Brien &amp; Daughters";

  it("keeps them readable in subjects", () => {
    assert.equal(
      email.sellerBroadcastEmailSubject(stored),
      "Update from O'Brien & Daughters on Grainline",
    );
    assert.equal(
      email.renderNewListingFromFollowedMakerEmail({
        to: "a@example.com",
        makerName: stored,
        listingTitle: "Oak &amp; Iron Rack",
        listingPrice: "$10.00",
        listingUrl: "https://example.test/listing/1",
      }).subject,
      "O'Brien & Daughters just posted a new listing on Grainline",
    );
    assert.equal(
      email.renderWelcomeSellerEmail({ seller: { email: "a@example.com" } }).subject,
      "Welcome to Grainline - let's set up your shop!",
    );
  });

  it("does not show a literal &amp; in the body", () => {
    const { html } = email.renderBackInStockEmail({
      buyer: { email: "a@example.com" },
      listingTitle: "Oak &amp; Iron Rack",
      listingId: "listing-1",
    });
    assert.match(html, /Oak &amp; Iron Rack/);
    assert.doesNotMatch(html, /&amp;amp;/);
  });
});
