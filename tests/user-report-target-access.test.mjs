import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const source = readFileSync("src/app/api/users/[id]/report/route.ts", "utf8");

describe("user report target access guardrails", () => {
  it("keeps report reason categorical and free-text details separate", () => {
    const deletion = readFileSync("src/lib/accountDeletion.ts", "utf8");

    assert.match(source, /reason: z\.enum\(\["SPAM", "HARASSMENT", "FAKE_LISTING", "INAPPROPRIATE", "OTHER"\]\)/);
    assert.match(source, /details: z\.string\(\)\.max\(500\)\.optional\(\)/);
    assert.match(source, /const details = body\.details \? truncateText\(sanitizeText\(body\.details\), 500\) \|\| null : null/);
    assert.match(deletion, /tx\.userReport\.updateMany\(\{\s*where: \{ OR: \[\{ reporterId: user\.id \}, \{ reportedId: user\.id \}\] \},\s*data: \{ details: null \},\s*\}\)/);
  });

  it("requires reporter access before accepting private report targets", () => {
    assert.match(source, /let reporterCanAccess = false/);
    assert.match(source, /!exists \|\| !reporterCanAccess/);

    assert.match(
      source,
      /buyerId: me\.id/,
      "order reports must require the reporter to be the buyer or seller",
    );
    assert.match(
      source,
      /conversation: \{ OR: \[\{ userAId: me\.id \}, \{ userBId: me\.id \}\] \}/,
      "message reports must require the reporter to be in the conversation",
    );
    assert.match(
      source,
      /AND: \[\{ OR: \[\{ userAId: me\.id \}, \{ userBId: me\.id \}\] \}\]/,
      "thread reports must require the reporter to be in the conversation",
    );
    assert.match(
      source,
      /canViewListingDetail\(listing, \{ dbUserId: me\.id \}\)/,
      "listing reports must require public or reserved listing access",
    );
    assert.match(
      source,
      /post: publicBlogPostWhere\(\)/,
      "blog comment reports must be limited to comments on public posts",
    );
    assert.match(
      source,
      /"SELLER_PROFILE"/,
      "seller-profile reports must use the canonical seller profile target",
    );
    assert.match(
      source,
      /visibleSellerProfileWhere\(\{ id: body\.targetId, userId: reportedId \}\)/,
      "seller-profile reports must require a public seller profile owned by the reported user",
    );
  });

  it("keeps seller profile report UI and admin links aligned with the API target", () => {
    const sellerPage = readFileSync("src/app/seller/[id]/page.tsx", "utf8");
    const adminReports = readFileSync("src/app/admin/reports/page.tsx", "utf8");

    assert.match(sellerPage, /targetType="SELLER_PROFILE"/);
    assert.match(sellerPage, /targetId=\{seller\.id\}/);
    assert.doesNotMatch(sellerPage, /targetType="SELLER"/);
    assert.match(adminReports, /targetType === "SELLER_PROFILE" \|\| targetType === "SELLER"/);
    assert.match(adminReports, /isSellerProfileReportTarget\(r\.targetType\)/);
    assert.match(adminReports, /publicSellerPath\(seller\.id, seller\.displayName\)/);
  });
});
