import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  ACCOUNT_DELETION_AUDIT_REDACTION,
  redactAccountDeletionAuditMetadata,
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
      notes: ["approved by admin", ACCOUNT_DELETION_AUDIT_REDACTION],
      redactedForAccountDeletion: true,
    });
  });

  it("leaves unrelated metadata unchanged", () => {
    const metadata = { listingId: "listing_123", count: 2 };
    const result = redactAccountDeletionAuditMetadata(metadata, ["user_123"]);

    assert.equal(result.changed, false);
    assert.deepEqual(result.metadata, metadata);
  });
});
