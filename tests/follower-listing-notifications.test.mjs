import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("follower listing notification guardrails", () => {
  it("filters blocked follower pairs before in-app and email fanout", () => {
    const fanout = source("src/lib/followerListingNotifications.ts");

    assert.match(fanout, /import \{ publicListingWhere \} from "@\/lib\/listingVisibility"/);
    assert.match(fanout, /const publicListing = await prisma\.listing\.findFirst\(\{/);
    assert.match(fanout, /where: publicListingWhere\(\{ id: listing\.id, sellerId: sellerProfileId \}\)/);
    assert.match(fanout, /if \(!publicListing\) return/);
    assert.match(fanout, /const sellerUserId = publicListing\.seller\.userId/);
    assert.match(fanout, /followerId: \{ not: sellerUserId \}/);
    assert.match(fanout, /blocks: \{ none: \{ blockedId: sellerUserId \} \}/);
    assert.match(fanout, /blockedBy: \{ none: \{ blockerId: sellerUserId \} \}/);
    assert.ok(
      fanout.indexOf("where: publicListingWhere({ id: listing.id, sellerId: sellerProfileId })") <
        fanout.indexOf("const followers = await prisma.follow.findMany"),
      "public listing state must be rechecked before follower lookup",
    );
    assert.ok(
      fanout.indexOf("blocks: { none: { blockedId: sellerUserId } }") <
        fanout.indexOf("await mapWithConcurrency(followers, 10"),
      "block filtering must happen before in-app notification fanout",
    );
    assert.ok(
      fanout.indexOf("blockedBy: { none: { blockerId: sellerUserId } }") <
        fanout.indexOf("await mapWithConcurrency(followers.filter"),
      "block filtering must happen before email fanout",
    );
  });

  it("keeps blog follower notifications behind the same reciprocal block filters", () => {
    const blogNew = source("src/app/dashboard/blog/new/page.tsx");
    const blogEdit = source("src/app/dashboard/blog/[id]/edit/page.tsx");
    const blogFanout = source("src/lib/followerBlogNotifications.ts");

    assert.match(blogNew, /import \{ fanOutBlogPostToFollowers \} from "@\/lib\/followerBlogNotifications"/);
    assert.match(blogNew, /fanOutBlogPostToFollowers\(\{ postId: newPost\.id, sellerProfileId \}\)/);
    assert.doesNotMatch(blogNew, /take: 10000/);

    assert.match(blogEdit, /import \{ fanOutBlogPostToFollowers \} from "@\/lib\/followerBlogNotifications"/);
    assert.match(blogEdit, /const publishedSellerProfileId = updated\.sellerProfileId/);
    assert.match(blogEdit, /postId: updated\.id/);
    assert.match(blogEdit, /sellerProfileId: publishedSellerProfileId/);
    assert.doesNotMatch(blogEdit, /take: 10000/);

    assert.match(blogFanout, /import \{ publicBlogPostWhere \} from "@\/lib\/blogVisibility"/);
    assert.match(blogFanout, /const BLOG_FOLLOWER_FANOUT_PAGE_SIZE = 1000/);
    assert.match(blogFanout, /where: publicBlogPostWhere\(\{ id: postId, sellerProfileId \}\)/);
    assert.match(blogFanout, /if \(!publicPost\?\.sellerProfile\?\.userId\) return/);
    assert.match(blogFanout, /const sellerUserId = publicPost\.sellerProfile\.userId/);
    assert.match(blogFanout, /followerId: \{ not: sellerUserId \}/);
    assert.match(blogFanout, /blocks: \{ none: \{ blockedId: sellerUserId \} \}/);
    assert.match(blogFanout, /blockedBy: \{ none: \{ blockerId: sellerUserId \} \}/);
    assert.match(blogFanout, /orderBy: \{ id: "asc" \}/);
    assert.match(blogFanout, /\.\.\.\(cursor \? \{ cursor: \{ id: cursor \}, skip: 1 \} : \{\}\)/);
    assert.match(blogFanout, /take: BLOG_FOLLOWER_FANOUT_PAGE_SIZE/);
    assert.match(blogFanout, /sourceType: "followed_maker_new_blog"/);
    assert.match(blogFanout, /sourceId: publicPost\.id/);
    assert.ok(
      blogFanout.indexOf("where: publicBlogPostWhere({ id: postId, sellerProfileId })") <
        blogFanout.indexOf("const followers = await prisma.follow.findMany"),
      "public blog state must be rechecked before follower lookup",
    );
    assert.ok(
      blogFanout.indexOf("blocks: { none: { blockedId: sellerUserId } }") <
        blogFanout.indexOf("await mapWithConcurrency(followers, 10"),
      "block filtering must happen before blog notification fanout",
    );
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
