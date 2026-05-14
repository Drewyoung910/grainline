import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("social interaction route hardening", () => {
  it("bounds public blog comment reads and rejects replies to hidden or inactive parents", () => {
    const route = source("src/app/api/blog/[slug]/comments/route.ts");

    assert.match(route, /TOP_LEVEL_COMMENT_LIMIT = 100/);
    assert.match(route, /REPLY_COMMENT_LIMIT = 50/);
    assert.match(route, /NESTED_REPLY_COMMENT_LIMIT = 25/);
    assert.match(route, /take: TOP_LEVEL_COMMENT_LIMIT/);
    assert.match(route, /take: REPLY_COMMENT_LIMIT/);
    assert.match(route, /take: NESTED_REPLY_COMMENT_LIMIT/);
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

    assert.match(route, /source: "follow_notification"/);
    assert.match(route, /Failed to create follow notification/);
    assert.match(route, /return NextResponse\.json\(\{ following: true, followerCount \}\)/);
  });

  it("keeps commission-request reports limited to public open commission targets", () => {
    const route = source("src/app/api/users/[id]/report/route.ts");

    assert.match(route, /openCommissionWhere/);
    assert.match(route, /openCommissionWhere\(\{ id: body\.targetId, buyerId: reportedId \}\)/);
  });
});
