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
    assert.match(fanout, /userFollowerNotificationPage\(prisma, \{/);
    assert.match(fanout, /afterFollowId: cursor/);
    assert.match(fanout, /limit: FOLLOWER_FANOUT_PAGE_SIZE/);
    assert.doesNotMatch(fanout, /prisma\.follow\.findMany/);
    assert.ok(
      fanout.indexOf("where: publicListingWhere({ id: listing.id, sellerId: sellerProfileId })") <
        fanout.indexOf("const followers = await userFollowerNotificationPage"),
      "public listing state must be rechecked before follower lookup",
    );
    assert.ok(
      fanout.indexOf("const followers = await userFollowerNotificationPage") <
        fanout.indexOf("await mapWithConcurrency(followers, 10"),
      "fixed reciprocal-block follower filtering must happen before in-app notification fanout",
    );
    assert.ok(
      fanout.indexOf("const followers = await userFollowerNotificationPage") <
        fanout.indexOf("userEmailDeliveryRecipients(prisma, {"),
      "fixed reciprocal-block follower filtering must happen before email fanout",
    );
    assert.match(fanout, /preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING"/);
    assert.match(fanout, /await mapWithConcurrency\(emailRecipients, 5/);
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
    assert.match(blogFanout, /userFollowerNotificationPage\(prisma, \{/);
    assert.match(blogFanout, /afterFollowId: cursor/);
    assert.match(blogFanout, /limit: BLOG_FOLLOWER_FANOUT_PAGE_SIZE/);
    assert.doesNotMatch(blogFanout, /prisma\.follow\.findMany/);
    assert.match(blogFanout, /sourceType: NOTIFICATION_SOURCE_TYPES\.FOLLOWED_MAKER_NEW_BLOG/);
    assert.match(blogFanout, /sourceId: publicPost\.id/);
    assert.ok(
      blogFanout.indexOf("where: publicBlogPostWhere({ id: postId, sellerProfileId })") <
        blogFanout.indexOf("const followers = await userFollowerNotificationPage"),
      "public blog state must be rechecked before follower lookup",
    );
    assert.ok(
      blogFanout.indexOf("const followers = await userFollowerNotificationPage") <
        blogFanout.indexOf("await mapWithConcurrency(followers, 10"),
      "fixed reciprocal-block follower filtering must happen before blog notification fanout",
    );
  });

  it("filters seller broadcast follower recipients before notifications and email outbox jobs", () => {
    const broadcastRoute = source("src/app/api/seller/broadcast/route.ts");

    assert.match(broadcastRoute, /userOwnerBroadcastFollowers\(me\.id, \{/);
    assert.match(broadcastRoute, /sellerProfileId: seller\.id/);
    assert.match(broadcastRoute, /sellersOnly/);
    assert.doesNotMatch(broadcastRoute, /prisma\.follow\.findMany/);
    assert.ok(
      broadcastRoute.indexOf("userOwnerBroadcastFollowers(me.id, {") <
        broadcastRoute.indexOf("const notificationFollowers = followers.filter"),
      "owner-bound reciprocal-block filtering must happen before in-app recipient filtering",
    );
    assert.ok(
      broadcastRoute.indexOf("userOwnerBroadcastFollowers(me.id, {") <
        broadcastRoute.indexOf("const emailFollowers = (await Promise.all("),
      "owner-bound reciprocal-block filtering must happen before email recipient filtering",
    );
    assert.match(broadcastRoute, /userEmailDeliveryRecipients\(prisma, \{[\s\S]*preferenceKey: "EMAIL_SELLER_BROADCAST"/);
  });
});
