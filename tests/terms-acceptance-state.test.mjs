import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  CURRENT_TERMS_VERSION,
  currentTermsAcceptanceUpdate,
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

  it("records a fresh timestamp when users accept a newer terms version", () => {
    const oldAcceptedAt = new Date("2026-04-01T00:00:00.000Z");
    const oldAgeAttestedAt = new Date("2026-04-01T00:00:00.000Z");
    const acceptedAt = new Date("2026-05-07T12:00:00.000Z");

    const update = currentTermsAcceptanceUpdate(
      {
        termsAcceptedAt: oldAcceptedAt,
        termsVersion: "2025-01-01",
        ageAttestedAt: oldAgeAttestedAt,
      },
      acceptedAt,
    );

    assert.equal(update.termsAcceptedAt, acceptedAt);
    assert.equal(update.ageAttestedAt, acceptedAt);
    assert.equal(update.termsVersion, CURRENT_TERMS_VERSION);
  });

  it("keeps the original evidence timestamp for duplicate current-version submissions", () => {
    const originalAcceptedAt = new Date("2026-05-07T00:00:00.000Z");
    const originalAgeAttestedAt = new Date("2026-05-07T00:01:00.000Z");
    const duplicateAcceptedAt = new Date("2026-05-07T12:00:00.000Z");

    const update = currentTermsAcceptanceUpdate(
      {
        termsAcceptedAt: originalAcceptedAt,
        termsVersion: CURRENT_TERMS_VERSION,
        ageAttestedAt: originalAgeAttestedAt,
      },
      duplicateAcceptedAt,
    );

    assert.equal(update.termsAcceptedAt, originalAcceptedAt);
    assert.equal(update.ageAttestedAt, originalAgeAttestedAt);
    assert.equal(update.termsVersion, CURRENT_TERMS_VERSION);
  });
});
