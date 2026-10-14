import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { sellerProfilePrivateMigrationPath } from "./helpers/seller-profile-private-migration-path.mjs";
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
    const revocationAuthority = source(
      sellerProfilePrivateMigrationPath("20261014200000_prepare_seller_profile_private_guild_member_revocation_authority"),
    );
    const staffTransitionAuthority = source(
      sellerProfilePrivateMigrationPath("20261014220000_prepare_seller_profile_private_guild_staff_transition_authority"),
    );

    assert.match(
      cron,
      /applySellerGuildMemberRevocation\(seller\.id\)/,
    );
    assert.match(revocationAuthority, /grainline_case_guild_unresolved_guard/);
    assert.match(revocationAuthority, /UPDATE public\."MakerVerification"[\s\S]*UPDATE public\."SellerProfile"/);
    assert.match(admin, /applySellerGuildStaffTransition\(getOrderStaffReadClient\(\), \{/);
    assert.match(admin, /operation: "REINSTATE_GUILD_MEMBER"/);
    assert.match(staffTransitionAuthority, /grainline_case_guild_unresolved_guard\(source_seller\.id\)/);
    assert.match(staffTransitionAuthority, /UPDATE public\."MakerVerification"[\s\S]*UPDATE public\."SellerProfile"/);
    assert.doesNotMatch(cron, /\bprisma\.case\./);
    assert.doesNotMatch(admin, /\b(?:prisma|tx)\.case\./);
    assert.doesNotMatch(revocationAuthority, /FROM public\."Case"/);
    assert.doesNotMatch(staffTransitionAuthority, /FROM public\."Case"/);
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
        admin.indexOf("const me = await userClerkGate(prisma, userId)"),
    );
  });
});
