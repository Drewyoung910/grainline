import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function compile(path) {
  return ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
}

function load(path, dependencies, extraGlobals = {}) {
  const stub = () => new Proxy(function () {}, {
    get: (_target, key) => (key === "then" ? undefined : stub()),
    apply: () => undefined,
  });
  const exports = {};
  vm.runInNewContext(compile(path), {
    exports, Date, Math, console, Promise, Error, ...extraGlobals,
    require: (name) => dependencies[name] ?? stub(),
  }, { filename: path });
  return exports;
}

function sessionSweep(pages, { expireFails = [], restoreFails = false } = {}) {
  const calls = { expired: [], restored: [], reported: [] };
  const remaining = [...pages];
  const exports = load("src/lib/checkoutSessionExpiry.ts", {
    "@sentry/nextjs": { captureException: (error, context) => calls.reported.push(context.tags.source) },
    "@/lib/stripe": {
      stripe: {
        checkout: {
          sessions: {
            list: async () => remaining.shift(),
            expire: async (id) => {
              if (expireFails.includes(id)) throw new Error("stripe down");
              calls.expired.push(id);
            },
          },
        },
      },
    },
    "@/lib/checkoutStockRestore": {
      restoreBuyerExpiredCheckoutStockOnce: async ({ buyerId, sessionId }) => {
        if (restoreFails) throw new Error("db down");
        calls.restored.push([buyerId, sessionId]);
      },
    },
  });
  return { calls, sweep: exports.expireOpenCheckoutSessionsForBuyer };
}

const session = (id, buyerId) => ({ id, metadata: { buyerId, sellerId: "seller" } });

test("a banned buyer's open checkouts close and give their stock back, nobody else's", async () => {
  const { calls, sweep } = sessionSweep([
    { data: [session("cs_mine_1", "banned"), session("cs_other", "someone")], has_more: true },
    { data: [session("cs_mine_2", "banned"), { id: "cs_bare", metadata: null }], has_more: false },
  ]);
  const result = await sweep({ buyerId: "banned", source: "ban_user" });
  assert.deepEqual(calls.expired, ["cs_mine_1", "cs_mine_2"]);
  assert.deepEqual(calls.restored, [["banned", "cs_mine_1"], ["banned", "cs_mine_2"]]);
  assert.equal(result.expired, 2);
  assert.equal(result.failed, 0);
});

test("one failure is reported and does not stop the rest of the sweep", async () => {
  const { calls, sweep } = sessionSweep([
    { data: [session("cs_bad", "banned"), session("cs_good", "banned")], has_more: false },
  ], { expireFails: ["cs_bad"] });
  const result = await sweep({ buyerId: "banned", source: "ban_user" });
  assert.deepEqual(calls.expired, ["cs_good"]);
  assert.equal(result.failed, 1);
  assert.deepEqual(calls.reported, ["ban_user_buyer_checkout_session_expire"]);
});

test("banning an account sweeps its checkouts as a buyer, even with no shop", async () => {
  const swept = [];
  const exports = load("src/lib/ban.ts", {
    "./checkoutSessionExpiry": {
      expireOpenCheckoutSessionsForBuyer: async (input) => swept.push(input),
      expireOpenCheckoutSessionsForSeller: async () => ({ checked: 0, expired: 0, failed: 0 }),
    },
    "./userStaffAccess": {
      userStaffBanTarget: async () => ({ banned: false, deletedAt: null, role: "USER", clerkId: "clerk" }),
      mintUserStaffCapability: async () => "capability",
      userStaffBanApply: async () => ({ clerkId: "clerk" }),
    },
    "./sellerStaffPrivateAccess": {
      sellerStaffOrderabilityState: async () => null,
      transitionSellerStaffOrderability: async () => null,
    },
    "./orderBanReviewAuthority": {
      mintBanReviewCapability: async () => "review",
      flagBannedSellerOpenOrders: async () => [],
    },
    "./dbUserContext": {
      withDbUserContext: (_id, callback) => callback({
        commissionRequest: { findMany: async () => [], updateMany: async () => ({ count: 0 }) },
        adminAuditLog: { create: async () => ({ id: "audit" }) },
      }),
    },
    "./banAuditMetadata": { buildBanAuditMetadata: () => ({}) },
    "./clerkUserLifecycle": { banClerkUserAndRevokeSessions: async () => ({ revokedSessionCount: 1 }) },
    "./db": { prisma: { adminAuditLog: { create: async () => ({ id: "log" }) } } },
  });
  await exports.banUser({ userId: "buyer", adminId: "admin", reason: "reason" });
  assert.equal(swept.length, 1);
  assert.equal(swept[0].buyerId, "buyer");
});

test("hiding a listing finds its checkout even past the first page of line items", async () => {
  const expired = [];
  const lines = Array.from({ length: 30 }, (_, index) => ({
    price: { product: { metadata: { listingId: `listing_${index}` } } },
  }));
  const exports = load("src/lib/checkoutSessionExpiry.ts", {
    "@/lib/stripe": {
      stripe: {
        checkout: {
          sessions: {
            list: async () => ({ data: [{ id: "cs_cart", metadata: { cartId: "cart" } }], has_more: false }),
            // What Stripe does: a retrieve expands only the first 10 lines.
            retrieve: async () => ({ line_items: { data: lines.slice(0, 10) } }),
            listLineItems: async () => ({ data: lines }),
            expire: async (id) => expired.push(id),
          },
        },
      },
    },
    "@/lib/checkoutSessionExpiryState": {
      checkoutSessionMetadataReferencesListing: () => false,
    },
    "@/lib/checkoutStockRestore": { restoreSellerExpiredCheckoutStockOnce: async () => {} },
  });
  const result = await exports.expireOpenCheckoutSessionsForListing({
    listingId: "listing_25",
    sellerId: "seller",
    source: "test",
  });
  assert.equal(result.expired, 1);
  assert.deepEqual(expired, ["cs_cart"]);
});
