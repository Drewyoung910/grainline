import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  CURRENT_TERMS_VERSION,
  hasAcceptedCurrentTerms,
  shouldRequireTermsAcceptance,
} = await import("../src/lib/termsAcceptance.ts");

describe("terms acceptance state", () => {
  it("requires a timestamp, current version, and age attestation", () => {
    const accepted = {
      termsAcceptedAt: new Date("2026-05-07T00:00:00.000Z"),
      termsVersion: CURRENT_TERMS_VERSION,
      ageAttestedAt: new Date("2026-05-07T00:00:00.000Z"),
    };

    assert.equal(hasAcceptedCurrentTerms(accepted), true);
    assert.equal(shouldRequireTermsAcceptance(accepted), false);

    assert.equal(hasAcceptedCurrentTerms({ ...accepted, termsAcceptedAt: null }), false);
    assert.equal(hasAcceptedCurrentTerms({ ...accepted, termsVersion: null }), false);
    assert.equal(hasAcceptedCurrentTerms({ ...accepted, termsVersion: "legacy" }), false);
    assert.equal(hasAcceptedCurrentTerms({ ...accepted, ageAttestedAt: null }), false);
    assert.equal(shouldRequireTermsAcceptance(null), true);
  });
});
