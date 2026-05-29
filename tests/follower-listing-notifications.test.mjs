import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("follower listing notification guardrails", () => {
  it("filters blocked follower pairs before in-app and email fanout", () => {
    const fanout = source("src/lib/followerListingNotifications.ts");

    assert.match(fanout, /const seller = await prisma\.sellerProfile\.findUnique\(\{[\s\S]*select: \{ userId: true \}/);
    assert.match(fanout, /if \(!seller\) return/);
    assert.match(fanout, /followerId: \{ not: seller\.userId \}/);
    assert.match(fanout, /blocks: \{ none: \{ blockedId: seller\.userId \} \}/);
    assert.match(fanout, /blockedBy: \{ none: \{ blockerId: seller\.userId \} \}/);
    assert.ok(
      fanout.indexOf("blocks: { none: { blockedId: seller.userId } }") <
        fanout.indexOf("await mapWithConcurrency(followers, 10"),
      "block filtering must happen before in-app notification fanout",
    );
    assert.ok(
      fanout.indexOf("blockedBy: { none: { blockerId: seller.userId } }") <
        fanout.indexOf("await mapWithConcurrency(followers.filter"),
      "block filtering must happen before email fanout",
    );
  });

  it("keeps blog follower notifications behind the same reciprocal block filters", () => {
    const blogNew = source("src/app/dashboard/blog/new/page.tsx");
    const blogEdit = source("src/app/dashboard/blog/[id]/edit/page.tsx");

    assert.match(blogNew, /followerId: \{ not: author\.id \}/);
    assert.match(blogNew, /blocks: \{ none: \{ blockedId: author\.id \} \}/);
    assert.match(blogNew, /blockedBy: \{ none: \{ blockerId: author\.id \} \}/);

    assert.match(blogEdit, /sellerProfile: \{ select: \{ displayName: true, userId: true \} \}/);
    assert.match(blogEdit, /const sellerUserId = updated\.sellerProfile!\.userId/);
    assert.match(blogEdit, /followerId: \{ not: sellerUserId \}/);
    assert.match(blogEdit, /blocks: \{ none: \{ blockedId: sellerUserId \} \}/);
    assert.match(blogEdit, /blockedBy: \{ none: \{ blockerId: sellerUserId \} \}/);
  });

  it("filters seller broadcast follower recipients before notifications and email outbox jobs", () => {
    const broadcastRoute = source("src/app/api/seller/broadcast/route.ts");

    assert.match(broadcastRoute, /followerId: \{ not: me\.id \}/);
    assert.match(broadcastRoute, /blocks: \{ none: \{ blockedId: me\.id \} \}/);
    assert.match(broadcastRoute, /blockedBy: \{ none: \{ blockerId: me\.id \} \}/);
    assert.ok(
      broadcastRoute.indexOf("blocks: { none: { blockedId: me.id } }") <
        broadcastRoute.indexOf("const notificationFollowers = followers.filter"),
      "broadcast block filtering must happen before in-app recipient filtering",
    );
    assert.ok(
      broadcastRoute.indexOf("blockedBy: { none: { blockerId: me.id } }") <
        broadcastRoute.indexOf("const emailFollowers = followers.filter"),
      "broadcast block filtering must happen before email recipient filtering",
    );
  });
});
