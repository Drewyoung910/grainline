import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

import { privateJson, privateResponse } from "../src/lib/privateResponse.ts";

const routePath = "src/app/api/listings/recently-viewed/route.ts";

function fixture({ signedOut = false, ids = "listing-b,listing-a,listing-b" } = {}) {
  const state = {
    authorityCalls: [],
    favoriteAuthorityCalls: [],
  };
  const authorityRows = [
    {
      id: "listing-b",
      title: "Walnut table",
      priceCents: 12500,
      currency: "usd",
      photoUrl: "https://example.test/table.jpg",
      sellerDisplayName: "Oak & Grain",
      sellerAvatarImageUrl: "https://example.test/avatar.jpg",
    },
    {
      id: "listing-a",
      title: "Maple stool",
      priceCents: 8000,
      currency: "usd",
      photoUrl: null,
      sellerDisplayName: "Maple Works",
      sellerAvatarImageUrl: null,
    },
  ];
  const prisma = {
    listing: {
      findMany: async () => {
        throw new Error("direct recently-viewed listing relation read reached");
      },
    },
    favorite: {
      findMany: async () => {
        throw new Error("direct recently-viewed favorite relation read reached");
      },
    },
  };
  const dependencies = {
    "@clerk/nextjs/server": {
      auth: async () => ({ userId: signedOut ? null : "clerk-buyer" }),
    },
    "@/lib/db": { prisma },
    "@/lib/blocks": { getBlockedSellerProfileIdsFor: async () => [] },
    "@/lib/listingVisibility": { publicListingWhere: (where) => where },
    "@/lib/ratelimit": {
      searchRatelimit: {},
      getIP: () => "127.0.0.1",
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
    "@/lib/ensureUser": {
      ensureUserByClerkId: async () => ({ id: "buyer" }),
    },
    "@/lib/favoriteAccess": {
      ownerFavoriteListingIds: async (userId, listingIds) => {
        state.favoriteAuthorityCalls.push({ userId, listingIds });
        return new Set(["listing-a"]);
      },
    },
    "@/lib/privateResponse": { privateJson, privateResponse },
    "@/lib/sellerProfilePublicAccess": {
      sellerPublicRecentlyViewedListings: async (viewerUserId, listingIds) => {
        state.authorityCalls.push({ viewerUserId, listingIds });
        return authorityRows;
      },
    },
  };
  const javascript = ts.transpileModule(readFileSync(routePath, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports,
    Request,
    Response,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`);
      return dependencies[name];
    },
  }, { filename: routePath });
  return {
    state,
    get: () => exports.GET({
      nextUrl: new URL(
        `https://example.test/api/listings/recently-viewed?ids=${encodeURIComponent(ids)}`,
      ),
    }),
  };
}

test("recently viewed uses the viewer-aware bounded listing-card authority", async () => {
  const subject = fixture();
  const response = await subject.get();
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(subject.state.authorityCalls), JSON.stringify([{
    viewerUserId: "buyer",
    listingIds: ["listing-b", "listing-a", "listing-b"],
  }]));
  assert.equal(JSON.stringify(subject.state.favoriteAuthorityCalls), JSON.stringify([{
    userId: "buyer",
    listingIds: ["listing-b", "listing-a", "listing-b"],
  }]));
  assert.deepEqual(await response.json(), {
    listings: [
      {
        id: "listing-b",
        title: "Walnut table",
        priceCents: 12500,
        currency: "usd",
        photoUrl: "https://example.test/table.jpg",
        sellerDisplayName: "Oak & Grain",
        sellerAvatarImageUrl: "https://example.test/avatar.jpg",
        saved: false,
      },
      {
        id: "listing-a",
        title: "Maple stool",
        priceCents: 8000,
        currency: "usd",
        photoUrl: null,
        sellerDisplayName: "Maple Works",
        sellerAvatarImageUrl: null,
        saved: true,
      },
      {
        id: "listing-b",
        title: "Walnut table",
        priceCents: 12500,
        currency: "usd",
        photoUrl: "https://example.test/table.jpg",
        sellerDisplayName: "Oak & Grain",
        sellerAvatarImageUrl: "https://example.test/avatar.jpg",
        saved: false,
      },
    ],
    ids: ["listing-b", "listing-a", "listing-b"],
  });
});

test("signed-out recently viewed uses the same authority without actor context", async () => {
  const subject = fixture({ signedOut: true });
  const response = await subject.get();
  assert.equal(response.status, 200);
  assert.equal(JSON.stringify(subject.state.authorityCalls), JSON.stringify([{
    viewerUserId: null,
    listingIds: ["listing-b", "listing-a", "listing-b"],
  }]));
  assert.equal(subject.state.favoriteAuthorityCalls.length, 0);
  assert.equal((await response.json()).listings.length, 3);
});

test("malformed recently-viewed ids fail closed as an empty result", async () => {
  const subject = fixture({ ids: "bad id,../../secret" });
  const response = await subject.get();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { listings: [] });
  assert.equal(subject.state.authorityCalls.length, 0);
  assert.equal(subject.state.favoriteAuthorityCalls.length, 0);
});
