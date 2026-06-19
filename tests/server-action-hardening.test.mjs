import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("server action hardening guardrails", () => {
  it("keeps onboarding actions current-seller scoped and first-party media constrained", () => {
    const actions = source("src/app/dashboard/onboarding/actions.ts");

    assert.match(actions, /where: \{ user: \{ clerkId: userId \} \}/);
    assert.match(actions, /banned: true, deletedAt: true/);
    assert.match(actions, /isFirstPartyMediaUrlForUser\(avatarImageUrl, seller\.clerkUserId/);
    assert.match(actions, /updateMany\(\{\s*where: \{ id: seller\.id, onboardingStep: seller\.onboardingStep \}/s);
  });

  it("keeps admin server actions behind local active-staff gates", () => {
    for (const path of ["src/app/admin/actions.ts", "src/app/admin/support/actions.ts"]) {
      const actions = source(path);
      assert.match(actions, /select: \{ id: true, role: true, banned: true, deletedAt: true \}/);
      assert.match(actions, /user\.banned/);
      assert.match(actions, /user\.deletedAt/);
      assert.match(actions, /user\.role !== "EMPLOYEE" && user\.role !== "ADMIN"/);
    }
  });

  it("keeps listing action follower fanout and AI-review failures observable without rolling back primary work", () => {
    const shopActions = source("src/app/seller/[id]/shop/actions.ts");
    const createPage = source("src/app/dashboard/listings/new/page.tsx");

    assert.match(shopActions, /source: "listing_activation_follower_fanout"/);
    assert.match(shopActions, /listingId: listing\.id/);
    assert.match(shopActions, /sellerProfileId: listing\.sellerId/);
    assert.match(shopActions, /source: "listing_publish_ai_review"/);
    assert.match(shopActions, /source: "listing_publish_ai_review_followup"/);
    assert.match(shopActions, /source: "listing_publish_ai_error_mark_failed"/);
    assert.match(shopActions, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(shopActions, /logServerError\(error, \{/);
    assert.match(shopActions, /logServerError\(updateError, \{/);
    for (const sourceTag of [
      "listing_publish_ai_review",
      "listing_publish_ai_review_followup",
      "listing_publish_ai_error_mark_failed",
    ]) {
      const sourceIndex = shopActions.indexOf(`source: "${sourceTag}"`);
      const blockStart = shopActions.lastIndexOf("catch", sourceIndex);
      const block = shopActions.slice(blockStart, sourceIndex + 160);
      assert.match(block, /logServerError\((error|updateError), \{/);
      assert.doesNotMatch(block, /Sentry\.captureException\((error|updateError), \{/);
    }

    assert.match(createPage, /source: "listing_create_ai_review"/);
    assert.match(createPage, /source: "listing_create_ai_error_mark_failed"/);
    assert.match(createPage, /source: "listing_create_follower_fanout"/);
    assert.match(createPage, /source: "listing_create_geo_metro_assignment"/);
    assert.match(createPage, /logServerError\(error, \{/);
    assert.match(createPage, /logServerError\(updateError, \{/);
    assert.match(createPage, /logServerError\(e, \{/);
    assert.doesNotMatch(createPage, /console\.error\("\[listing-create\]/);
    assert.match(createPage, /updateMany\(\{\s*where: \{ id: created\.id, status: ListingStatus\.PENDING_REVIEW \}/s);
    const createFanoutBlock = createPage.slice(createPage.lastIndexOf("fanOutListingToFollowers"));
    assert.doesNotMatch(createFanoutBlock, /catch \{ \/\* non-fatal \*\/ \}/);
  });
});
