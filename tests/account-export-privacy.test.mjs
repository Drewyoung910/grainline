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

  it("exports email suppressions by the same exact and canonical keys used for delivery checks", () => {
    const route = source("src/app/api/account/export/route.ts");
    const suppressionStart = route.indexOf("prisma.emailSuppression.findMany");
    const suppressionBlock = route.slice(suppressionStart, route.indexOf("prisma.stockNotification.findMany", suppressionStart));

    assert.match(route, /import \{ emailSuppressionAddressKeys, normalizeEmailAddress \}/);
    assert.match(route, /const accountEmailSuppressionKeys = accountEmail \? emailSuppressionAddressKeys\(accountEmail\) : \[\]/);
    assert.match(suppressionBlock, /where: \{ email: \{ in: accountEmailSuppressionKeys \} \}/);
    assert.doesNotMatch(suppressionBlock, /where: \{ email: accountEmail \}/);
  });

  it("keeps account export behind POST, same-origin, and fresh session checks", () => {
    const route = source("src/app/api/account/export/route.ts");
    const settingsPage = source("src/app/account/settings/page.tsx");
    const exportButton = source("src/components/AccountExportButton.tsx");

    assert.match(route, /import \{ auth, reverificationErrorResponse \} from "@clerk\/nextjs\/server"/);
    assert.match(route, /getExplicitCrossOriginPostRejection\(req\)/);
    assert.match(route, /hasFreshAccountExportSession\(session\.factorVerificationAge\)/);
    assert.match(route, /reverificationErrorResponse\(ACCOUNT_EXPORT_REVERIFICATION\)/);
    assert.match(route, /export async function GET\(\) \{[\s\S]*status: 405[\s\S]*Allow: "POST"/);
    assert.match(route, /export async function POST\(req: Request\)/);
    assert.doesNotMatch(route, /handleExport\("GET"\)/);

    const guardIndex = route.indexOf("getExplicitCrossOriginPostRejection(req)");
    const authIndex = route.indexOf("await auth()");
    const freshnessIndex = route.indexOf("hasFreshAccountExportSession(session.factorVerificationAge)");
    const buildIndex = route.indexOf("await buildExport(user)");
    const auditIndex = route.indexOf("await logUserAuditAction");
    const downloadIndex = route.indexOf("return jsonDownload(payload, user.id)");

    assert.ok(guardIndex > -1);
    assert.ok(authIndex > guardIndex);
    assert.ok(freshnessIndex > authIndex);
    assert.ok(buildIndex > freshnessIndex);
    assert.ok(auditIndex > buildIndex);
    assert.ok(downloadIndex > auditIndex);

    assert.match(settingsPage, /<AccountExportButton \/>/);
    assert.doesNotMatch(settingsPage, /href="\/api\/account\/export"/);
    assert.match(exportButton, /useReverification\(fetchAccountExport\)/);
    assert.match(exportButton, /method: "POST"/);
    assert.match(exportButton, /response\.json\(\)\.catch/);
    assert.doesNotMatch(exportButton, /content-type/);
    assert.doesNotMatch(exportButton, /window\.location\.href\s*=\s*"\/api\/account\/export"/);
  });
});
