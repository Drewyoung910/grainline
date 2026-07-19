import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("social interaction route hardening", () => {
  it("bounds public blog comment reads and rejects replies to hidden or inactive parents", () => {
    const route = source("src/app/api/blog/[slug]/comments/route.ts");
    const limits = source("src/lib/blogCommentLimits.ts");

    assert.match(limits, /TOP_LEVEL_BLOG_COMMENT_LIMIT = 100/);
    assert.match(limits, /BLOG_REPLY_COMMENT_LIMIT = 50/);
    assert.match(limits, /BLOG_NESTED_REPLY_COMMENT_LIMIT = 25/);
    assert.match(route, /take: TOP_LEVEL_BLOG_COMMENT_LIMIT/);
    assert.match(route, /take: BLOG_REPLY_COMMENT_LIMIT/);
    assert.match(route, /take: BLOG_NESTED_REPLY_COMMENT_LIMIT/);
    assert.match(route, /parent\.author\.banned/);
    assert.match(route, /parent\.author\.deletedAt/);
    assert.match(route, /!parent\.approved/);
    assert.match(route, /grandparent\.author\.banned/);
    assert.match(route, /grandparent\.author\.deletedAt/);
    assert.match(route, /!grandparent\.approved/);
  });

  it("keeps review creation idempotent under duplicate-submit races and non-masks seller notifications", () => {
    const route = source("src/app/api/reviews/route.ts");

    assert.match(route, /code\?: string/);
    assert.match(route, /code === "P2002"/);
    assert.match(route, /Already reviewed/);
    assert.match(route, /source: "review_notification"/);
    assert.match(route, /source: "review_notification_email"/);
  });

  it("keeps follow notification failures from masking a successful follow mutation", () => {
    const route = source("src/app/api/follow/[sellerId]/route.ts");
    const notifications = source("src/lib/notifications.ts");
    const serviceSql = source("docs/rls-drafts/notification-service-authority.sql");

    assert.match(route, /import \{ logServerError \} from "@\/lib\/serverErrorLogger"/);
    assert.match(route, /logServerError\(error, \{/);
    assert.match(route, /source: "follow_notification"/);
    assert.doesNotMatch(route, /console\.error\("Failed to create follow notification:/);
    assert.match(route, /return privateJson\(\{ following: true, followerCount \}\)/);
    assert.match(notifications, /createNotificationServiceRow\(\{/);
    assert.match(serviceSql, /ON CONFLICT \("userId", "type", "dedupKey"\) DO NOTHING/);
    assert.match(serviceSql, /notification\."userId" = p_user_id[\s\S]{0,120}notification\."dedupKey" = p_dedup_key/);
  });

  it("keeps follow buttons from serializing seller user ids to clients", () => {
    const followButton = source("src/components/FollowButton.tsx");
    const docs = source("CLAUDE.md");
    const publicFollowSurfaces = [
      "src/app/page.tsx",
      "src/app/account/following/page.tsx",
      "src/app/listing/[id]/page.tsx",
      "src/app/seller/[id]/page.tsx",
      "src/app/seller/[id]/shop/page.tsx",
      "src/app/blog/[slug]/page.tsx",
    ];

    assert.doesNotMatch(followButton, /sellerUserId/);
    for (const path of publicFollowSurfaces) {
      assert.doesNotMatch(source(path), /<FollowButton\b(?:(?!\/>)[\s\S])*sellerUserId=/);
    }
    assert.doesNotMatch(
      source("src/app/account/following/page.tsx"),
      /vacationReturnDate: true,\s*userId: true,\s*guildLevel: true/,
    );
    assert.match(docs, /Do not pass seller `userId` into this client component/);
  });

  it("keeps commission-request reports limited to public open commission targets", () => {
    const route = source("src/app/api/users/[id]/report/route.ts");

    assert.match(route, /openCommissionWhere/);
    assert.match(route, /openCommissionWhere\(\{ id: body\.targetId, buyerId: reportedId \}\)/);
  });
});
