import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("User current-Clerk authority reuse", () => {
  it("routes blog comment creation through the accepted account gate", () => {
    const route = source("src/app/api/blog/[slug]/comments/route.ts");
    const post = route.slice(route.indexOf("export async function POST"));

    assert.match(post, /const \{ userId \} = await auth\(\)/);
    assert.match(post, /const me = await userClerkGate\(prisma, userId\)/);
    assert.match(post, /if \(!me\)[\s\S]*if \(me\.banned \|\| me\.deletedAt\)/);
    assert.ok(
      post.indexOf("userClerkGate(prisma, userId)") <
        post.indexOf("safeRateLimit(blogCommentRatelimit, me.id)"),
      "the bounded account gate must establish the rate-limit subject",
    );
    assert.doesNotMatch(
      post,
      /prisma\.user\.findUnique\([\s\S]*?where:\s*\{\s*clerkId:\s*userId/,
    );
  });

  it("reuses the authenticated checkout account email", () => {
    const route = source("src/app/api/cart/checkout-seller/route.ts");

    assert.match(route, /const me = await ensureUserByClerkId\(userId\)/);
    assert.match(route, /const buyerEmail = me\.email/);
    assert.ok(
      route.indexOf("ensureUserByClerkId(userId)") <
        route.indexOf("const buyerEmail = me.email"),
      "checkout must derive email from the server-bound account bootstrap",
    );
    assert.doesNotMatch(route, /const userWithEmail =/);
    assert.doesNotMatch(
      route,
      /prisma\.user\.findUnique\([\s\S]*?where:\s*\{\s*clerkId:\s*userId/,
    );
  });

  it("keeps provider deletion blockers after the bounded Clerk gate", () => {
    const deletion = source("src/lib/accountDeletion.ts");
    const byClerk = deletion.slice(
      deletion.indexOf("export async function anonymizeUserAccountByClerkId"),
    );

    assert.match(byClerk, /const user = await userClerkGate\(prisma, clerkId\)/);
    assert.match(byClerk, /if \(!user\) return \{ ok: true, alreadyDeleted: true, userAbsent: true \}/);
    assert.match(byClerk, /if \(user\.deletedAt\) return \{ ok: true, alreadyDeleted: true \}/);
    assert.ok(
      byClerk.indexOf("getAccountDeletionBlockers(user.id)") <
        byClerk.indexOf("return anonymizeUserAccount(user.id)"),
      "provider deletion must preserve the blocker check before anonymization",
    );
    assert.doesNotMatch(byClerk, /prisma\.user\.findUnique/);
  });

  it("routes messaging actors through the narrow current-Clerk authority", () => {
    for (const path of [
      "src/app/messages/[id]/page.tsx",
      "src/app/api/messages/custom-order-request/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /userClerkActor/);
      assert.match(text, /const me = await userClerkActor\(prisma, userId\)/);
      assert.doesNotMatch(
        text,
        /prisma\.user\.findUnique\(\{[\s\S]*?where:\s*\{\s*clerkId:\s*userId/,
      );
    }
  });

  it("routes commission context through its bounded authority", () => {
    for (const path of [
      "src/app/commission/page.tsx",
      "src/app/commission/[param]/page.tsx",
      "src/app/api/commission/route.ts",
      "src/app/api/commission/[id]/interest/route.ts",
    ]) {
      const text = source(path);
      assert.match(text, /userClerkCommissionContext/);
      assert.match(text, /await userClerkCommissionContext\(prisma, userId\)/);
      assert.doesNotMatch(
        text,
        /prisma\.user\.findUnique\(\{[\s\S]*?where:\s*\{\s*clerkId:\s*userId/,
      );
    }
  });
});
