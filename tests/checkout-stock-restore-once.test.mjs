import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

// The real restore functions, for a session whose reservation cannot be found by
// session id. Before this, every such session added stock back from its metadata.
function subject({ abortResult = { result: "restored", checkoutLockKey: "lock", stockVisibilityChanged: 0 } } = {}) {
  const path = "src/lib/checkoutStockRestore.ts";
  const calls = { aborts: [], legacyTransactions: 0, stockWrites: 0, lockReleases: 0 };
  const absent = async () => ({ result: "absent", checkoutLockKey: null, stockVisibilityChanged: 0 });
  const dependencies = {
    "@sentry/nextjs": { captureMessage() {}, captureException() {} },
    "@/lib/db": {
      prisma: {
        $transaction: async (callback) => {
          calls.legacyTransactions += 1;
          return callback({
            $executeRaw: async (sql) => {
              if (sql.join("").includes('"stockQuantity" + ')) calls.stockWrites += 1;
            },
            listing: { updateMany: async () => ({ count: 0 }) },
          });
        },
      },
    },
    "@/lib/checkoutSessionLock": {
      releaseCheckoutLock: async () => {
        calls.lockReleases += 1;
      },
    },
    "@/lib/searchCache": { revalidateFeaturedMakerCaches() {}, revalidateListingSearchCaches() {} },
    "@/lib/stripeWebhookState": {
      parsePositiveInt: (value, fallback) => (Number(value) > 0 ? Number(value) : fallback),
    },
    "@/lib/stripe": { stripe: {} },
    "@/lib/checkoutStockReservationRepairState": { checkoutStockReservationRepairAction() {} },
    "@/lib/stripeWebhookMaintenance": { claimLegacyStockRestore: async () => true },
    "@/lib/checkoutStockReservationAuthority": {
      abortCheckoutStockReservation: async (input) => {
        calls.aborts.push(input);
        return abortResult;
      },
      restoreBuyerExpiredCheckoutStockReservation: absent,
      restoreSellerExpiredCheckoutStockReservation: absent,
      restoreCheckoutStockReservationFromWebhook: absent,
    },
  };
  const javascript = ts.transpileModule(readFileSync(path, "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const exports = {};
  vm.runInNewContext(javascript, {
    exports, Map, Promise, console,
    require: (name) => {
      assert.ok(name in dependencies, name);
      return dependencies[name];
    },
  }, { filename: path });
  return { calls, exports };
}

const tagged = {
  checkoutReservationId: "reservation",
  buyerId: "buyer",
  checkoutPayloadHash: "h".repeat(32),
  checkoutLockKey: "lock",
  listingId: "listing",
  quantity: "1",
  reservedStock: "listing:1",
};

test("an expired session with an unbound reservation restores through the reservation, once", async () => {
  const { calls, exports } = subject();
  await exports.restoreUnorderedCheckoutStockOnce({
    eventId: "evt", claimGeneration: 1n, sessionId: "cs_lost", metadata: tagged,
  });
  assert.equal(calls.aborts.length, 1);
  assert.equal(calls.aborts[0].reservationId, "reservation");
  assert.equal(calls.stockWrites, 0);
  assert.equal(calls.legacyTransactions, 0);
  assert.equal(calls.lockReleases, 1);
});

test("a settled or pruned reservation adds no stock, from a sweep or a buyer's rollback", async () => {
  for (const result of ["terminal", "absent"]) {
    const { calls, exports } = subject({
      abortResult: { result, checkoutLockKey: null, stockVisibilityChanged: 0 },
    });
    await exports.restoreBuyerExpiredCheckoutStockOnce({ buyerId: "buyer", sessionId: "cs_old", metadata: tagged });
    await exports.restoreSellerExpiredCheckoutStockOnce({ sellerProfileId: "seller", sessionId: "cs_old", metadata: tagged });
    assert.equal(calls.stockWrites, 0);
    assert.equal(calls.legacyTransactions, 0);
  }
});

test("a session from before reservations still restores from its metadata", async () => {
  const { calls, exports } = subject();
  await exports.restoreBuyerExpiredCheckoutStockOnce({
    buyerId: "buyer",
    sessionId: "cs_legacy",
    metadata: { listingId: "listing", quantity: "1" },
  });
  assert.equal(calls.aborts.length, 0);
  assert.equal(calls.legacyTransactions, 1);
  assert.equal(calls.stockWrites, 1);
});
