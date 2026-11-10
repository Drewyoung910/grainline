import assert from "node:assert/strict";
import { test } from "node:test";
import { z } from "zod";
import { loadWithStubs } from "./helpers/load-with-stubs.mjs";

test("deleting a saved search with a NUL id is a 400, not a database error", async () => {
  const deleted = [];
  const route = loadWithStubs("src/app/api/search/saved/route.ts", {
    zod: { z },
    "@clerk/nextjs/server": { auth: async () => ({ userId: "clerk_1" }) },
    "@/lib/ensureUser": { ensureUser: async () => ({ id: "user_1" }) },
    "@/lib/requestOriginGuard": { getExplicitCrossOriginPostRejection: () => null },
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }) },
    "@/lib/privateResponse": { privateJson: (body, init) => Response.json(body, init) },
    "@/lib/savedSearchOwnerAccess": {
      deleteOwnerSavedSearch: async (_userId, id) => {
        if (id.includes("\u0000")) throw new Error("invalid byte sequence for encoding UTF8: 0x00");
        deleted.push(id);
      },
    },
  });
  const call = (id) => {
    const request = new Request(`https://example.test/api/search/saved?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    request.nextUrl = new URL(request.url);
    return route.DELETE(request);
  };

  assert.equal((await call("search\u0000x")).status, 400);
  assert.equal((await call("search_1")).status, 200);
  assert.deepEqual(deleted, ["search_1"]);
});
