import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { checkoutCompletionNeedsReview } = await import("../src/lib/checkoutCompletionState.ts");

describe("checkout completion review state", () => {
  const base = {
    quotedPostalCode: "78701",
    actualPostalCode: "78701-1234",
    quotedState: "TX",
    actualState: "tx",
    quotedCity: "Austin",
    actualCity: " austin ",
    quotedCountry: "US",
    actualCountry: "us",
    quotedShippingAmountCents: 1299,
    actualShippingAmountCents: 1299,
  };

  it("does not require review for normalized address and shipping amount matches", () => {
    assert.equal(checkoutCompletionNeedsReview(base), false);
  });

  it("requires review for changed postal, state, city, or country data", () => {
    assert.equal(checkoutCompletionNeedsReview({ ...base, actualPostalCode: "73301" }), true);
    assert.equal(checkoutCompletionNeedsReview({ ...base, actualState: "CA" }), true);
    assert.equal(checkoutCompletionNeedsReview({ ...base, actualCity: "Round Rock" }), true);
    assert.equal(checkoutCompletionNeedsReview({ ...base, actualCountry: "CA" }), true);
  });

  it("requires review when Stripe shipping amount differs from the quoted amount", () => {
    assert.equal(checkoutCompletionNeedsReview({ ...base, actualShippingAmountCents: 1499 }), true);
  });

  it("does not require review when no quoted value exists for a field", () => {
    assert.equal(
      checkoutCompletionNeedsReview({
        quotedPostalCode: "",
        actualPostalCode: "73301",
        quotedState: null,
        actualState: "CA",
        quotedCity: undefined,
        actualCity: "Round Rock",
        quotedCountry: "",
        actualCountry: "CA",
        quotedShippingAmountCents: null,
        actualShippingAmountCents: 1499,
      }),
      false,
    );
  });
});
