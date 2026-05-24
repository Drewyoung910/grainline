import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("admin server action guardrails", () => {
  it("blocks suspended or deleted staff accounts inside admin server actions", () => {
    for (const path of [
      "src/app/admin/actions.ts",
      "src/app/admin/support/actions.ts",
      "src/app/admin/blog/page.tsx",
      "src/app/admin/broadcasts/page.tsx",
      "src/app/admin/verification/page.tsx",
    ]) {
      const text = source(path);
      assert.match(
        text,
        /banned:\s*true/,
        `${path} must select staff banned state inside admin server actions`,
      );
      assert.match(
        text,
        /deletedAt:\s*true/,
        `${path} must select staff deletion state inside admin server actions`,
      );
      assert.match(
        text,
        /banned\s*\|\|\s*[^;\n]*deletedAt/,
        `${path} must block suspended or deleted staff accounts inside admin server actions`,
      );
    }
  });

  it("blocks suspended or deleted staff accounts inside admin pages and APIs", () => {
    for (const path of [
      "src/app/admin/audit/page.tsx",
      "src/app/admin/support/page.tsx",
      "src/app/admin/review/page.tsx",
      "src/app/admin/users/page.tsx",
      "src/app/admin/reports/page.tsx",
      "src/app/admin/reviews/page.tsx",
      "src/app/api/admin/listings/[id]/route.ts",
      "src/app/api/admin/listings/[id]/review/route.ts",
      "src/app/api/admin/users/[id]/ban/route.ts",
      "src/app/api/admin/audit/[id]/undo/route.ts",
      "src/app/api/admin/email/route.ts",
      "src/app/api/admin/reports/[id]/resolve/route.ts",
      "src/app/api/admin/reviews/[id]/route.ts",
      "src/app/api/admin/verify-pin/route.ts",
    ]) {
      const text = source(path);
      assert.match(
        text,
        /banned:\s*true/,
        `${path} must select staff banned state before admin access`,
      );
      assert.match(
        text,
        /deletedAt:\s*true/,
        `${path} must select staff deletion state before admin access`,
      );
      assert.match(
        text,
        /banned\s*\|\|\s*[^;\n]*deletedAt/,
        `${path} must block suspended or deleted staff accounts before admin access`,
      );
    }
  });

  it("rate-limits admin server actions before local admin DB lookups", () => {
    for (const path of [
      "src/app/admin/actions.ts",
      "src/app/admin/support/actions.ts",
      "src/app/admin/blog/page.tsx",
      "src/app/admin/broadcasts/page.tsx",
      "src/app/admin/verification/page.tsx",
    ]) {
      const text = source(path);
      assert.match(text, /adminActionRatelimit/, `${path} must use adminActionRatelimit`);
      assert.match(text, /safeRateLimit\(adminActionRatelimit, userId\)/, `${path} must rate-limit by Clerk userId before DB lookup`);
      assert.ok(
        text.indexOf("safeRateLimit(adminActionRatelimit, userId)") <
          text.indexOf("prisma.user.findUnique"),
        `${path} must rate-limit before local admin user lookup`,
      );
    }
  });

  it("does not allow admin email to become an arbitrary external sender", () => {
    const route = source("src/app/api/admin/email/route.ts");
    const usersPage = source("src/app/admin/users/page.tsx");

    assert.match(route, /Admin email can only be sent to an existing Grainline user/);
    assert.match(route, /where: \{ email: normalizedInputEmail \}/);
    assert.match(route, /recipientUserId = recipient\.id/);
    assert.match(route, /userId: recipientUserId/);
    assert.match(usersPage, /No Grainline user exists for/);
    assert.match(usersPage, /support mailbox for external replies/);
    assert.doesNotMatch(usersPage, /<AdminEmailForm\s+defaultTo=\{emailParam\}/);
  });

  it("handles stale broadcast deletes without throwing and cleans queued side effects", () => {
    const broadcasts = source("src/app/admin/broadcasts/page.tsx");

    assert.match(broadcasts, /tx\.sellerBroadcast\.findUnique/);
    assert.match(broadcasts, /tx\.sellerBroadcast\.deleteMany\(\{ where: \{ id \} \}\)/);
    assert.match(broadcasts, /if \(deleted\.count !== 1\) return/);
    assert.doesNotMatch(broadcasts, /sellerBroadcast\.delete\(\{/);
    assert.match(broadcasts, /tx\.notification\.deleteMany\(\{/);
    assert.match(broadcasts, /link: `\/account\/feed\?broadcast=\$\{broadcast\.id\}`/);
    assert.match(broadcasts, /tx\.emailOutbox\.deleteMany\(\{/);
    assert.match(broadcasts, /preferenceKey: "EMAIL_SELLER_BROADCAST"/);
  });
});
