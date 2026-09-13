import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { stripeStatementDescriptorSuffix } = await import("../src/lib/stripeStatementDescriptor.ts");

describe("Stripe statement descriptor suffix", () => {
  it("keeps valid seller names within Stripe's suffix length", () => {
    assert.equal(stripeStatementDescriptorSuffix("Oak & Thread Studio"), "OAK THREAD STUDIO");
    assert.equal(stripeStatementDescriptorSuffix("1234567890123456789012345"), "1234567890123456789012");
  });

  it("folds accented Latin names before stripping unsupported characters", () => {
    assert.equal(stripeStatementDescriptorSuffix("Atelier Ébène"), "ATELIER EBENE");
  });

  it("falls back when a seller name has no Stripe-supported descriptor characters", () => {
    assert.equal(stripeStatementDescriptorSuffix("林家具"), "GRAINLINE");
    assert.equal(stripeStatementDescriptorSuffix(null), "GRAINLINE");
  });
});
