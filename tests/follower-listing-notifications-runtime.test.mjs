import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

const modulePath = "src/lib/followerListingNotifications.ts";

function fixture({ target = undefined } = {}) {
  const state = {
    targetCalls: [],
    followerReads: 0,
    notifications: [],
  };
  const publicTarget = target === undefined ? {
    id: "listing",
    title: "Current title",
    priceCents: 12500,
    currency: "usd",
    seller: {
      id: "seller",
      userId: "seller-user",
      displayName: "Current workshop",
    },
  } : target;
  const prisma = {
    listing: {
      findFirst: async () => {
        throw new Error("direct listing-to-SellerProfile fanout read reached");
      },
    },
  };
  const dependencies = {
    "@/lib/db": { prisma },
    "@/lib/email": { renderNewListingFromFollowedMakerEmail: () => ({}) },
    "@/lib/emailOutbox": { enqueueEmailOutbox: async () => {} },
    "@/lib/notifications": {
      createNotification: async (input) => { state.notifications.push(input); },
    },
    "@/lib/notificationSources": {
      NOTIFICATION_SOURCE_TYPES: { FOLLOWED_MAKER_NEW_LISTING: "FOLLOWED_MAKER_NEW_LISTING" },
    },
    "@/lib/concurrency": {
      chunkArray: (items) => [items],
      mapWithConcurrency: async (items, _limit, worker) => Promise.all(items.map(worker)),
    },
    "@/lib/publicPaths": {
      publicListingPath: (id, title) => `/listing/${id}-${title}`,
    },
    "@/lib/money": { formatCurrencyCents: () => "$125.00" },
    "@/lib/emailBaseUrl": { EMAIL_APP_URL: "https://example.test" },
    "@/lib/userEmailDeliveryAccess": { userEmailDeliveryRecipients: async () => [] },
    "@/lib/userFollowerAccess": {
      userFollowerNotificationPage: async (_client, input) => {
        state.followerReads += 1;
        assert.equal(JSON.stringify(input), JSON.stringify({
          sourceType: "FOLLOWED_MAKER_NEW_LISTING",
          sourceId: "listing",
          limit: 1000,
        }));
        assert.equal(input.afterFollowId, undefined);
        return [{ followerId: "follower", followId: "follow" }];
      },
    },
    "@/lib/sellerProfilePublicAccess": {
      sellerPublicFollowerListingTarget: async (listingId, sellerProfileId) => {
        state.targetCalls.push({ listingId, sellerProfileId });
        return publicTarget;
      },
    },
    "@/lib/listingVisibility": { publicListingWhere: () => ({}) },
  };
  const javascript = ts.transpileModule(readFileSync(modulePath, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: modulePath });
  return { state, fanOutListingToFollowers: exports.fanOutListingToFollowers };
}

test("listing follower fanout uses the bounded fresh public target", async () => {
  const subject = fixture();
  await subject.fanOutListingToFollowers({
    sellerProfileId: "seller",
    sellerDisplayName: "Stale workshop",
    listing: { id: "listing", title: "Stale title", priceCents: 1, currency: "cad" },
    emailDedupKey: (followerId) => `listing:${followerId}`,
  });
  assert.equal(JSON.stringify(subject.state.targetCalls), JSON.stringify([
    { listingId: "listing", sellerProfileId: "seller" },
  ]));
  assert.equal(subject.state.followerReads, 1);
  assert.equal(JSON.stringify(subject.state.notifications), JSON.stringify([{
    userId: "follower",
    type: "FOLLOWED_MAKER_NEW_LISTING",
    title: "New listing from Current workshop",
    body: "Current title",
    link: "/listing/listing-Current title",
    sourceType: "FOLLOWED_MAKER_NEW_LISTING",
    sourceId: "listing",
    relatedUserId: "seller-user",
  }]));
});

test("listing follower fanout stops before follower reads when the target is no longer public", async () => {
  const subject = fixture({ target: null });
  await subject.fanOutListingToFollowers({
    sellerProfileId: "seller",
    sellerDisplayName: null,
    listing: { id: "listing", title: "Listing", priceCents: 12500, currency: "usd" },
    emailDedupKey: (followerId) => `listing:${followerId}`,
  });
  assert.equal(subject.state.followerReads, 0);
  assert.deepEqual(subject.state.notifications, []);
});
