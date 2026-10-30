import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const route = readFileSync("src/app/api/users/[id]/report/route.ts", "utf8");
const access = readFileSync("src/lib/userReportAccess.ts", "utf8");
const migrationDirectory =
  process.env.USER_REPORT_PREPARATION_MIGRATION_PATH ??
  "prisma/migrations/20261028060000_prepare_user_report_authorities";
const migration = readFileSync(`${migrationDirectory}/migration.sql`, "utf8");

describe("user report target access guardrails", () => {
  it("keeps categorical reasons, cleaned details, and one actor-bound write", () => {
    assert.match(route, /reason: z\.enum\(\["SPAM", "HARASSMENT", "FAKE_LISTING", "INAPPROPRIATE", "OTHER"\]\)/u);
    assert.match(route, /truncateText\(sanitizeText\(body\.details\), 500\)/u);
    assert.match(route, /codePointLength\(value\) <= 500/u);
    assert.match(route, /createUserReport\(\{/u);
    assert.match(access, /withDbUserContext\(actorUserId/u);
    assert.doesNotMatch(route, /prisma\.userReport\./u);
  });

  it("admits only report targets the reporter can actually inspect", () => {
    assert.match(access, /"LISTING",\s*"MESSAGE_THREAD",\s*"REVIEW",\s*"BLOG_COMMENT",\s*"SELLER_PROFILE"/u);
    assert.doesNotMatch(access, /"ORDER"|"MESSAGE"|"BLOG_POST"|"COMMISSION_REQUEST"/u);
    assert.match(migration, /actor_id IN \(conversation\."userAId", conversation\."userBId"\)/u);
    assert.match(migration, /p_reported_user_id IN \(\s*conversation\."userAId", conversation\."userBId"/u);
    assert.match(migration, /review\."reviewerId" = p_reported_user_id/u);
    assert.match(migration, /comment\."authorId" = p_reported_user_id/u);
    assert.match(migration, /public\.grainline_seller_public_report_target\(/u);
  });

  it("keeps seller profile report UI and admin links aligned with the API target", () => {
    const sellerPage = readFileSync("src/app/seller/[id]/page.tsx", "utf8");
    const adminReports = readFileSync("src/app/admin/reports/page.tsx", "utf8");
    const docs = readFileSync("CLAUDE.md", "utf8");

    assert.match(sellerPage, /targetType="SELLER_PROFILE"/u);
    assert.match(sellerPage, /targetId=\{seller\.id\}/u);
    assert.doesNotMatch(sellerPage, /targetType="SELLER"/u);
    assert.match(adminReports, /targetType === "SELLER_PROFILE" \|\| targetType === "SELLER"/u);
    assert.match(adminReports, /isSellerProfileReportTarget\(r\.targetType\)/u);
    assert.match(adminReports, /sellerProfileStaffReportTargets\(staffClient, \{/u);
    assert.doesNotMatch(adminReports, /prisma\.sellerProfile\./u);
    assert.match(adminReports, /publicSellerPath\(seller\.id, seller\.displayName\)/u);
    assert.match(docs, /\| Seller profiles \| `SELLER_PROFILE` \| `BlockReportButton` on `\/seller\/\[id\]` \|/u);
  });
});
