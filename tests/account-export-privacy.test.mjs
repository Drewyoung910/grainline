import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("account export privacy coverage", () => {
  it("exports owned listing photo originals and payment event metadata", () => {
    const route = source("src/app/api/account/export/route.ts");

    assert.match(route, /photos: \{ orderBy: \{ sortOrder: "asc" \}, select: \{ url: true, originalUrl: true/);
    assert.match(route, /paymentEvents: \{[\s\S]*metadata: true[\s\S]*createdAt: true/);
  });

  it("keeps explicit export collections for common user-owned records", () => {
    const route = source("src/app/api/account/export/route.ts");
    const payload = source("src/lib/accountExportPayload.ts");

    for (const model of [
      "block",
      "userReport",
      "supportRequest",
      "emailSuppression",
      "stockNotification",
      "makerVerification",
      "sellerFaq",
      "newsletterSubscriber",
      "sellerBroadcast",
      "reviewVote",
    ]) {
      assert.match(route, new RegExp(`prisma\\.${model}`), `account export must query ${model}`);
    }

    for (const key of [
      "blocks",
      "userReportsSubmitted",
      "userReportsReceived",
      "supportRequests",
      "emailSuppressions",
      "stockNotifications",
      "makerVerification",
      "sellerFaqs",
      "newsletterSubscriptions",
      "sellerBroadcasts",
      "reviewVotes",
    ]) {
      assert.match(payload, new RegExp(`${key}: data\\.${key}`), `payload must expose ${key}`);
    }
  });

  it("exports support and data-request records by stable account link with email fallback", () => {
    const schema = source("prisma/schema.prisma");
    const route = source("src/app/api/account/export/route.ts");
    const supportStart = route.indexOf("prisma.supportRequest.findMany");
    const supportEnd = route.indexOf("prisma.emailSuppression.findMany", supportStart);
    const supportBlock = route.slice(supportStart, supportEnd);

    assert.match(schema, /supportRequests\s+SupportRequest\[\]/);
    assert.match(schema, /userId\s+String\?/);
    assert.match(schema, /user\s+User\?\s+@relation\(fields: \[userId\], references: \[id\], onDelete: SetNull\)/);
    assert.match(schema, /@@index\(\[userId, createdAt\]\)/);
    assert.ok(supportStart >= 0, "account export must query supportRequest");
    assert.match(supportBlock, /supportRequestAccountExportWhere\(user\.id, accountEmail\)/);
    assert.match(supportBlock, /orderId: true/);
    assert.match(supportBlock, /listingId: true/);
    assert.doesNotMatch(supportBlock, /where:\s*\{\s*email:\s*accountEmail\s*\}/);
  });
});
