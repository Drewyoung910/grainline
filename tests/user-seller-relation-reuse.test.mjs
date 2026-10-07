import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import vm from "node:vm";
import test from "node:test";
import ts from "typescript";
import { HTTP_STATUS } from "../src/lib/httpStatus.ts";
import { privateJson, privateResponse } from "../src/lib/privateResponse.ts";

const require = createRequire(import.meta.url);
const path = "src/app/api/reviews/[id]/reply/route.ts";

// Actual route with isolated ports: proves route admission and predicates,
// not PostgreSQL scheduling or deployed behavior.
function fixture(options = {}) {
  const actor = options.actor === undefined
    ? { id: "owner", banned: false, deletedAt: null } : options.actor;
  const state = { owner: "owner", active: true, reply: options.reply ?? null,
    reads: 0, writes: 0, gateCalls: 0 };
  let bothRead;
  const barrier = new Promise((resolve) => { bothRead = resolve; });
  const prisma = { review: {
    findUnique: async () => {
      state.reads++;
      if (options.missingReview) return null;
      const snapshot = {
        sellerReply: state.reply,
        listing: { seller: { userId: options.foreignOwner ? "other-owner" : state.owner,
          ownerAccountActive: options.inactiveSeller ? false : state.active } },
      };
      if (options.concurrent) {
        if (state.reads === 2) bothRead();
        await barrier;
      }
      return snapshot;
    },
    updateMany: async ({ where, data }) => {
      state.writes++;
      assert.equal(where.id, "review");
      assert.equal(where.sellerReply, null);
      assert.equal(where.listing.seller.userId, actor.id);
      assert.equal(where.listing.seller.ownerAccountActive, true);
      if (options.changeBeforeWrite) options.changeBeforeWrite(state);
      if (state.reply !== null || state.owner !== where.listing.seller.userId
        || state.active !== true) return { count: 0 };
      state.reply = data.sellerReply;
      return { count: 1 };
    },
  } };
  const dependencies = {
    "@clerk/nextjs/server": { auth: async () => ({ userId: options.signedOut ? null : "clerk-owner" }) },
    "@/lib/db": { prisma },
    zod: require("zod"),
    "@/lib/sanitize": { truncateText: (text, length) => text.slice(0, length), sanitizeRichText: (text) => text },
    "@/lib/profanity": { containsProfanity: () => ({ flagged: false }) },
    "@/lib/profanityTelemetry": {},
    "@/lib/ratelimit": { safeRateLimit: async () => ({ success: true }) },
    "@/lib/requestBody": { readBoundedJson: async (req) => req.json() },
    "@/lib/privateResponse": { privateJson, privateResponse },
    "@/lib/httpStatus": { HTTP_STATUS },
    "@/lib/userIdentityAccess": { userClerkGate: async (client, clerkId) => {
      state.gateCalls++;
      assert.equal(client, prisma);
      assert.equal(clerkId, "clerk-owner");
      return actor;
    } },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Date,
    require(name) {
      assert.ok(Object.hasOwn(dependencies, name), "Unexpected dependency " + name);
      return dependencies[name];
    },
  }, { filename: path });
  return { state, post: (text = "Thanks for your review") => exports.POST(
    new Request("https://example.test/api/reviews/review/reply", {
      method: "POST", body: JSON.stringify({ text }),
    }), { params: Promise.resolve({ id: "review" }) },
  ) };
}

test("seller reply denies signed-out and unavailable actors before reading the review", async () => {
  for (const [options, status] of [
    [{ signedOut: true }, 401], [{ actor: null }, 403],
    [{ actor: { id: "owner", banned: true, deletedAt: null } }, 403],
    [{ actor: { id: "owner", banned: false, deletedAt: new Date() } }, 403],
  ]) {
    const subject = fixture(options);
    assert.equal((await subject.post()).status, status);
    assert.equal(subject.state.reads, 0);
    assert.equal(subject.state.writes, 0);
  }
});

test("reply requires an existing review, current owner, active seller and no saved reply", async () => {
  for (const [options, status] of [
    [{ missingReview: true }, 404], [{ foreignOwner: true }, 403],
    [{ inactiveSeller: true }, 403], [{ reply: "Existing reply" }, 400],
  ]) {
    const subject = fixture(options);
    assert.equal((await subject.post()).status, status);
    assert.equal(subject.state.writes, 0);
  }
});

test("two admitted replies issue conditional writes and only one can succeed", async () => {
  const subject = fixture({ concurrent: true });
  const responses = await Promise.all([subject.post("First reply"), subject.post("Second reply")]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  assert.equal(subject.state.reads, 2);
  assert.equal(subject.state.writes, 2);
  assert.ok(["First reply", "Second reply"].includes(subject.state.reply));
  for (const response of responses) {
    assert.equal(response.headers.get("cache-control"), "private, no-store, max-age=0");
    assert.equal(response.headers.get("vary"), "Cookie");
  }
});

test("write refuses ownership, activity or existing-reply changes after the preflight", async () => {
  for (const changeBeforeWrite of [
    (state) => { state.owner = "replacement-owner"; },
    (state) => { state.active = false; },
    (state) => { state.reply = "Already saved"; },
  ]) {
    const subject = fixture({ changeBeforeWrite });
    assert.equal((await subject.post("Unauthorized overwrite")).status, 409);
    assert.notEqual(subject.state.reply, "Unauthorized overwrite");
  }
});

test("active owner reply succeeds without a nested User lookup", async () => {
  const subject = fixture();
  const response = await subject.post();
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  assert.equal(subject.state.gateCalls, 1);
  assert.equal(subject.state.reply, "Thanks for your review");
});
