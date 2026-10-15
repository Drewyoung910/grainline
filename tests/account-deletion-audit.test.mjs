import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  ACCOUNT_DELETION_AUDIT_REDACTION,
  ACCOUNT_DELETION_TEXT_REDACTION,
  markAccountDeletionAuditMetadata,
  redactAccountDeletionAuditMetadata,
  redactAccountDeletionText,
} = await import("../src/lib/accountDeletionAuditRedaction.ts");

describe("account deletion audit metadata redaction", () => {
  it("redacts deleted account identifiers deeply while preserving non-PII context", () => {
    const result = redactAccountDeletionAuditMetadata(
      {
        sellerId: "seller_123",
        postId: "post_abc",
        author: {
          id: "user_123",
          email: "Drew@Example.com",
          counts: [1, 2, 3],
        },
        notes: ["approved by admin", "clerk:user_123"],
      },
      ["user_123", "seller_123", "drew@example.com"],
    );

    assert.equal(result.changed, true);
    assert.deepEqual(result.metadata, {
      sellerId: ACCOUNT_DELETION_AUDIT_REDACTION,
      postId: "post_abc",
      author: {
        id: ACCOUNT_DELETION_AUDIT_REDACTION,
        email: ACCOUNT_DELETION_AUDIT_REDACTION,
        counts: [1, 2, 3],
        redactedForAccountDeletion: true,
      },
      notes: ["approved by admin", `clerk:${ACCOUNT_DELETION_AUDIT_REDACTION}`],
      redactedForAccountDeletion: true,
    });
  });

  it("leaves unrelated metadata unchanged", () => {
    const metadata = { listingId: "listing_123", count: 2 };
    const result = redactAccountDeletionAuditMetadata(metadata, ["user_123"]);

    assert.equal(result.changed, false);
    assert.deepEqual(result.metadata, metadata);
  });

  it("preserves word fragments while redacting bounded short values", () => {
    const unrelated = redactAccountDeletionAuditMetadata(
      { action: "listing approved", reason: "listing remains visible" },
      ["Li"],
    );
    assert.equal(unrelated.changed, false);
    assert.deepEqual(unrelated.metadata, {
      action: "listing approved",
      reason: "listing remains visible",
    });

    const related = redactAccountDeletionAuditMetadata(
      { note: "Li approved this listing" },
      ["Li"],
    );
    assert.equal(related.changed, true);
    assert.deepEqual(related.metadata, {
      note: `${ACCOUNT_DELETION_AUDIT_REDACTION} approved this listing`,
      redactedForAccountDeletion: true,
    });

    const bounded = redactAccountDeletionAuditMetadata(
      { status: "REJECTED", note: "Ted approved this listing" },
      ["Ted"],
    );
    assert.equal(bounded.changed, true);
    assert.deepEqual(bounded.metadata, {
      status: "REJECTED",
      note: `${ACCOUNT_DELETION_AUDIT_REDACTION} approved this listing`,
      redactedForAccountDeletion: true,
    });
  });

  it("marks related audit metadata without discarding unrelated context", () => {
    const result = markAccountDeletionAuditMetadata({
      listingId: "listing_123",
      statusBefore: "PUBLISHED",
    });

    assert.equal(result.changed, true);
    assert.deepEqual(result.metadata, {
      listingId: "listing_123",
      statusBefore: "PUBLISHED",
      redactedForAccountDeletion: true,
    });
  });

  it("redacts notification text case-insensitively without broad matching tiny values", () => {
    const result = redactAccountDeletionText(
      "Drew Young sent a message from drew@example.com about a listing.",
      ["drew young", "DREW@example.com", "dy"],
    );

    assert.equal(result.changed, true);
    assert.equal(
      result.text,
      `${ACCOUNT_DELETION_TEXT_REDACTION} sent a message from ${ACCOUNT_DELETION_TEXT_REDACTION} about a listing.`,
    );

    const short = redactAccountDeletionText("Li sent a note about a listing.", ["li"]);
    assert.equal(short.changed, true);
    assert.equal(short.text, `${ACCOUNT_DELETION_TEXT_REDACTION} sent a note about a listing.`);

    const embedded = redactAccountDeletionText("The rejected listing is ready.", ["Ted"]);
    assert.equal(embedded.changed, false);
    assert.equal(embedded.text, "The rejected listing is ready.");
  });

  it("caps redacted database text by Unicode character count", () => {
    const closure = `Shipped replacement to Alaska. ${"x".repeat(3969)}`;
    assert.equal(Array.from(closure).length, 4000);
    const result = redactAccountDeletionText(
      closure,
      ["Alaska"],
      ACCOUNT_DELETION_TEXT_REDACTION,
      4000,
    );
    assert.equal(result.changed, true);
    assert.equal(Array.from(result.text).length, 4000);
    assert.doesNotMatch(result.text, /\bAlaska\b/u);

    const unicode = redactAccountDeletionText("Texas🧵", ["Texas"], "deleted", 8);
    assert.equal(Array.from(unicode.text).length, 8);
    assert.equal(unicode.text, "deleted🧵");
    assert.throws(
      () => redactAccountDeletionText("text", [], undefined, 0),
      /positive integer/u,
    );
  });
});
