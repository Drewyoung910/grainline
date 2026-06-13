import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

const { notificationDedupKey } = await import("../src/lib/notificationDedup.ts");

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("notification dedup keys", () => {
  const date = new Date("2026-04-27T12:00:00.000Z");

  it("dedups by recipient, type, link, and UTC day", () => {
    const first = notificationDedupKey({
      userId: "user_123",
      type: "NEW_FAVORITE",
      link: "/listing/listing_123",
      date,
    });
    const second = notificationDedupKey({
      userId: "user_123",
      type: "NEW_FAVORITE",
      link: "/listing/listing_123",
      date,
    });

    assert.equal(first, second);
    assert.match(first, /^[a-f0-9]{64}$/);
  });

  it("does not depend on notification title or body copy", () => {
    const key = notificationDedupKey({
      userId: "user_123",
      type: "FOLLOWED_MAKER_NEW_LISTING",
      link: "/listing/listing_123",
      date,
    });

    assert.equal(
      key,
      notificationDedupKey({
        userId: "user_123",
        type: "FOLLOWED_MAKER_NEW_LISTING",
        link: "/listing/listing_123",
        date,
      }),
    );
  });

  it("separates different users, types, links, and unscoped UTC-day buckets", () => {
    const base = notificationDedupKey({
      userId: "user_123",
      type: "NEW_FAVORITE",
      link: "/listing/listing_123",
      date,
    });

    assert.notEqual(
      base,
      notificationDedupKey({ userId: "user_456", type: "NEW_FAVORITE", link: "/listing/listing_123", date }),
    );
    assert.notEqual(
      base,
      notificationDedupKey({ userId: "user_123", type: "NEW_FOLLOWER", link: "/listing/listing_123", date }),
    );
    assert.notEqual(
      base,
      notificationDedupKey({ userId: "user_123", type: "NEW_FAVORITE", link: "/listing/listing_456", date }),
    );
    assert.notEqual(
      base,
      notificationDedupKey({
        userId: "user_123",
        type: "NEW_FAVORITE",
        link: "/listing/listing_123",
        date: new Date("2026-04-28T00:00:00.000Z"),
      }),
    );
  });

  it("can scope same-link notifications to their source actor or action across days", () => {
    const firstFollower = notificationDedupKey({
      userId: "seller_123",
      type: "NEW_FOLLOWER",
      link: "/dashboard/analytics",
      dedupScope: "follower_1",
      date,
    });
    const retriedFirstFollower = notificationDedupKey({
      userId: "seller_123",
      type: "NEW_FOLLOWER",
      link: "/dashboard/analytics",
      dedupScope: "follower_1",
      date: new Date("2026-04-28T00:00:00.000Z"),
    });
    const secondFollower = notificationDedupKey({
      userId: "seller_123",
      type: "NEW_FOLLOWER",
      link: "/dashboard/analytics",
      dedupScope: "follower_2",
      date,
    });

    assert.equal(firstFollower, retriedFirstFollower);
    assert.notEqual(firstFollower, secondFollower);
  });

  it("keeps stable social notifications on durable relationship scopes", () => {
    const followRoute = source("src/app/api/follow/[sellerId]/route.ts");
    const favoriteRoute = source("src/app/api/favorites/route.ts");

    assert.match(followRoute, /type: "NEW_FOLLOWER",[\s\S]*dedupScope: me\.id,/);
    assert.match(favoriteRoute, /type: "NEW_FAVORITE",[\s\S]*dedupScope: me\.id,/);
  });
});
