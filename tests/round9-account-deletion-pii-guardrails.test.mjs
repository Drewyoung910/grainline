import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

const ORDER_PII_FIELDS = [
  "shipToCity",
  "shipToState",
  "shipToPostalCode",
  "shipToCountry",
  "quotedToCity",
  "quotedToState",
  "quotedToPostalCode",
  "quotedToCountry",
  "trackingCarrier",
  "trackingNumber",
  "sellerNotes",
  "shippoShipmentId",
  "shippoRateObjectId",
  "shippoTransactionId",
  "labelUrl",
  "labelCarrier",
  "labelTrackingNumber",
];

describe("Round 9 account deletion PII guardrails", () => {
  it("scrubs retained order address, tracking, label, and seller-note PII on delete and retention prune", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const retention = source("src/lib/orderPiiRetention.ts");

    for (const field of ORDER_PII_FIELDS) {
      assert.match(deletion, new RegExp(`${field}: null`), `account deletion must clear ${field}`);
      assert.match(retention, new RegExp(`"${field}" = NULL`), `retention prune must clear ${field}`);
      assert.match(retention, new RegExp(`"${field}" IS NOT NULL`), `retention prune must detect ${field}`);
    }

    assert.match(deletion, /buyerDataPurgedAt: now/);
    assert.match(retention, /"buyerDataPurgedAt" = NOW\(\)/);
  });

  it("removes bidirectional block residue and keeps media cleanup scoped to the deleted sender", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /tx\.block\.deleteMany\(\{\s*where: \{ OR: \[\{ blockerId: user\.id \}, \{ blockedId: user\.id \}\] \} \}\)/);
    assert.match(deletion, /prisma\.message\.findMany\(\{\s*where: \{ senderId: userId \}/s);
    assert.doesNotMatch(deletion, /where: \{ OR: \[\{ senderId: userId \}, \{ recipientId: userId \}\] \}/);
  });

  it("redacts other-party message and case-message bodies that quote deleted-account values", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    assert.match(deletion, /function bodyTextMatchSql\(value: string\)/);
    assert.match(deletion, /FROM "Message"[\s\S]*"senderId" <> \$\{deletedUserId\}[\s\S]*"recipientId" = \$\{deletedUserId\}/);
    assert.match(deletion, /FROM "CaseMessage"[\s\S]*"authorId" <> \$\{deletedUserId\}[\s\S]*"caseId" IN \([\s\S]*FROM "Case"[\s\S]*"buyerId" = \$\{deletedUserId\}[\s\S]*OR "sellerId" = \$\{deletedUserId\}/);
    assert.match(deletion, /redactMessagesAboutDeletedAccount\(tx, user\.id, accountSensitiveValues\)/);
    assert.match(deletion, /redactCaseMessagesAboutDeletedAccount\(tx, user\.id, accountSensitiveValues\)/);
  });

  it("uses saved shipping fields as deletion redaction needles", () => {
    const deletion = source("src/lib/accountDeletion.ts");

    for (const field of [
      "shippingName",
      "shippingLine1",
      "shippingLine2",
      "shippingCity",
      "shippingState",
      "shippingPostalCode",
      "shippingPhone",
    ]) {
      assert.match(deletion, new RegExp(`user\\.${field}`), `sensitive values must include ${field}`);
    }
  });
});
