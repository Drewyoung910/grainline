import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  validateCaseGuildUnresolvedGuard,
  validateCaseSellerActiveCount,
  validateCaseVerificationEligibility,
} from "../src/lib/caseSellerAggregateResult.ts";

function source(path) {
  return fs.readFileSync(path, "utf8");
}

describe("Case seller aggregate application authority", () => {
  it("fails closed on malformed aggregate rows", () => {
    assert.equal(
      validateCaseSellerActiveCount([{ activeCount: 2n }]),
      2,
    );
    assert.deepEqual(
      validateCaseVerificationEligibility([{
        agedUnresolvedCount: 1n,
      }]),
      {
        agedUnresolvedCount: 1,
      },
    );
    assert.deepEqual(
      validateCaseGuildUnresolvedGuard([{
        blocked: false,
      }]),
      {
        blocked: false,
      },
    );
    assert.equal(validateCaseVerificationEligibility([]), null);
    assert.equal(validateCaseGuildUnresolvedGuard([]), null);

    for (const rows of [
      [],
      [{ activeCount: -1n }],
      [{ activeCount: 1.5 }],
      [{ activeCount: "1" }],
      [{ activeCount: 1n }, { activeCount: 2n }],
    ]) {
      assert.throws(
        () => validateCaseSellerActiveCount(rows),
        /invalid (?:row count|count)/,
      );
    }
    assert.throws(
      () => validateCaseGuildUnresolvedGuard([{
        blocked: 0,
      }]),
      /invalid result/,
    );
  });

  it("exposes only the three fixed one-statement wrappers", () => {
    const authority = source("src/lib/caseSellerAggregateAuthority.ts");
    assert.match(authority, /grainline_case_seller_active_count/);
    assert.match(
      authority,
      /grainline_case_seller_verification_eligibility/,
    );
    assert.match(authority, /grainline_case_guild_unresolved_guard/);
    assert.match(authority, /normalizeDbUserContextUserId/);
    assert.match(authority, /normalizeSellerProfileId/);
    assert.doesNotMatch(
      authority,
      /prisma\.(?:case|caseMessage|sellerProfile)|\$queryRawUnsafe|\$transaction/,
    );
  });

  it("converts every seller verification and metrics Case reference", () => {
    const files = [
      "src/app/admin/verification/page.tsx",
      "src/app/api/verification/apply/route.ts",
      "src/app/dashboard/verification/page.tsx",
      "src/lib/metrics.ts",
    ];
    for (const path of files) {
      const body = source(path);
      assert.doesNotMatch(body, /\b(?:prisma|db|tx)\.case\./, path);
    }
    assert.match(
      source("src/lib/metrics.ts"),
      /getCaseSellerActiveCount\(sellerProfileId, db\)/,
    );
    for (const path of files.slice(0, 3)) {
      assert.match(
        source(path),
        /getCaseSellerVerificationEligibility/,
        path,
      );
    }
  });

  it("rechecks the Guild predicate inside revocation and reinstatement transactions", () => {
    const cron = source("src/app/api/cron/guild-member-check/route.ts");
    const admin = source("src/app/admin/verification/page.tsx");
    const state = source("src/lib/guildMemberRevocationState.ts");

    assert.match(
      cron,
      /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*guard\.kind === "unresolved_case"[\s\S]*getCaseGuildUnresolvedGuard\(seller\.id, tx\)[\s\S]*makerVerification\.updateMany/,
    );
    assert.match(
      admin,
      /prisma\.\$transaction\(async \(tx\) => \{[\s\S]*getCaseGuildUnresolvedGuard\(\s*sellerProfileId,\s*tx,[\s\S]*makerVerification\.updateMany/,
    );
    assert.doesNotMatch(cron, /\bprisma\.case\./);
    assert.doesNotMatch(admin, /\b(?:prisma|tx)\.case\./);
    assert.doesNotMatch(state, /casesAsSeller|Prisma\.CaseWhereInput/);
  });

  it("revalidates the session-bound admin PIN inside verification actions", () => {
    const admin = source("src/app/admin/verification/page.tsx");
    assert.match(admin, /const \{ userId, sessionId \} = await auth\(\)/);
    assert.match(admin, /const cookieStore = await cookies\(\)/);
    assert.match(
      admin,
      /verifyAdminPinCookieValue\([\s\S]*ADMIN_PIN_COOKIE_NAME[\s\S]*userId,[\s\S]*sessionId/,
    );
    assert.match(admin, /if \(!pinVerified\) redirect\("\/admin"\)/);
    assert.ok(
      admin.indexOf("if (!pinVerified)") <
        admin.indexOf("const me = await prisma.user.findUnique"),
    );
  });
});
