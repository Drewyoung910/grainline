import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";

import { HTTP_STATUS } from "../src/lib/httpStatus.ts";
import { privateJson, privateResponse } from "../src/lib/privateResponse.ts";

const require = createRequire(import.meta.url);
const routePath = "src/app/api/favorites/route.ts";

function fixture(options = {}) {
  const actor = options.actor ?? { id: "buyer", name: "Buyer" };
  const target = options.target === undefined
    ? { listingId: "listing", title: "Walnut bench", ownerUserId: "seller" }
    : options.target;
  const state = {
    targetCalls: 0,
    blockReads: 0,
    favoriteWrites: 0,
    notifications: [],
    errors: [],
  };
  const prisma = {
    favorite: {
      upsert: async ({ where, update, create }) => {
        state.favoriteWrites += 1;
        assert.equal(JSON.stringify(where), JSON.stringify({
          userId_listingId: { userId: actor.id, listingId: "listing" },
        }));
        assert.equal(JSON.stringify(update), "{}");
        assert.equal(
          JSON.stringify(create),
          JSON.stringify({ userId: actor.id, listingId: "listing" }),
        );
        if (options.favoriteError) throw new Error("favorite failed");
      },
    },
  };
  const dependencies = {
    "@clerk/nextjs/server": {
      auth: async () => ({ userId: options.signedOut ? null : "clerk-buyer" }),
    },
    "@/lib/db": { prisma },
    "@/lib/ensureUser": { ensureUser: async () => actor },
    "@/lib/apiAccountAccess": { accountAccessErrorResponse: () => null },
    "@/lib/notifications": {
      createNotification: async (input) => {
        state.notifications.push(input);
        if (options.notificationError) throw new Error("notification failed");
      },
    },
    "@/lib/ratelimit": {
      saveRatelimit: {},
      safeRateLimit: async () => ({ success: true, reset: 0 }),
      rateLimitResponse: () => new Response(null, { status: 429 }),
    },
    "@/lib/privateResponse": { privateJson, privateResponse },
    "@/lib/sellerProfilePublicAccess": {
      sellerPublicFavoriteTarget: async (listingId) => {
        state.targetCalls += 1;
        assert.equal(listingId, "listing");
        return target;
      },
    },
    "@/lib/publicPaths": {
      publicListingPath: (listingId, title) => `/listing/${listingId}/${title}`,
    },
    "@/lib/notificationSources": {
      NOTIFICATION_SOURCE_TYPES: { FAVORITE: "FAVORITE" },
    },
    "@/lib/requestBody": {
      readBoundedJson: async (request) => request.json(),
      isInvalidJsonBodyError: () => false,
      isRequestBodyTooLargeError: () => false,
    },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/serverErrorLogger": {
      logServerError: (error, context) => state.errors.push({ error, context }),
    },
    "@/lib/blockAccess": {
      userBlockPairIsBlocked: async (actorId, targetUserId) => {
        state.blockReads += 1;
        assert.equal(actorId, actor.id);
        assert.equal(targetUserId, target.ownerUserId);
        return options.blocked === true;
      },
    },
    zod: require("zod"),
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
    post: () => exports.POST(new Request("https://example.test/api/favorites", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ listingId: "listing" }),
    })),
  };
}

test("favorite creation denies missing, self-owned and blocked targets before writing", async () => {
  for (const [options, status] of [
    [{ target: null }, 404],
    [{ target: { listingId: "listing", title: "Walnut bench", ownerUserId: "buyer" } }, 400],
    [{ blocked: true }, 403],
  ]) {
    const subject = fixture(options);
    assert.equal((await subject.post()).status, status);
    assert.equal(subject.state.targetCalls, 1);
    assert.equal(subject.state.favoriteWrites, 0);
  }
});

test("favorite creation writes once and notifies the bounded target owner", async () => {
  const subject = fixture();
  const response = await subject.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(subject.state.targetCalls, 1);
  assert.equal(subject.state.blockReads, 1);
  assert.equal(subject.state.favoriteWrites, 1);
  assert.equal(subject.state.notifications.length, 1);
  assert.equal(subject.state.notifications[0].userId, "seller");
  assert.equal(subject.state.notifications[0].body, "Walnut bench");
});

test("favorite notification failure remains non-fatal after the write", async () => {
  const subject = fixture({ notificationError: true });
  assert.equal((await subject.post()).status, 200);
  assert.equal(subject.state.favoriteWrites, 1);
  assert.equal(subject.state.notifications.length, 1);
  assert.equal(subject.state.errors[0]?.context?.source, "favorite_notification");
});
