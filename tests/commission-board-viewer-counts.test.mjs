import assert from "node:assert/strict";
import test from "node:test";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

test("the commission board counts interest for the signed-in viewer, so blocked makers do not count", async () => {
  const viewers = [];
  const page = loadWithStubs("src/app/commission/page.tsx", {
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk-1" }) },
    "@/lib/db": {
      prisma: {
        commissionRequest: {
          count: async () => 1,
          findMany: async () => [{ id: "request-1", referenceImageUrls: [], buyerName: "Ann", buyerImageUrl: null }],
        },
      },
    },
    "@/lib/userIdentityAccess": {
      userClerkCommissionContext: async () => ({ id: "viewer-1", sellerProfile: null }),
    },
    "@/lib/blocks": { getBlockedUserIdsFor: async () => new Set() },
    "@/lib/commissionInterestCount": {
      publicCommissionInterestCounts: async (_ids, viewerId) => {
        viewers.push(viewerId);
        return new Map();
      },
    },
    "@/lib/categories": { CATEGORY_VALUES: [], CATEGORY_LABELS: {} },
    "@/lib/queryParams": {
      firstSearchParams: (params) => params ?? {},
      parseBoundedPositiveIntParam: (_value, fallback) => fallback,
    },
  });
  const content = page.default({ searchParams: Promise.resolve({}) }).props.children;
  await content.type(content.props);
  assert.deepEqual(viewers, ["viewer-1"]);
});
