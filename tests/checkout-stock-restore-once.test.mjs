import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function subject({
  restoreResult = { result: "restored", checkoutLockKey: "lock", stockVisibilityChanged: 0 },
  restoreError = null,
} = {}) {
  const path = "src/lib/checkoutStockRestore.ts";
  const calls = { restores: [], messages: [], lockReleases: 0 };
  const absent = async () => ({ result: "absent", checkoutLockKey: null, stockVisibilityChanged: 0 });
  const dependencies = {
    "@sentry/nextjs": {
      captureMessage(message, context) {
        calls.messages.push({ message, context });
      },
      captureException() {},
    },
    "@/lib/checkoutSessionLock": {
      releaseCheckoutLock: async () => {
        calls.lockReleases += 1;
      },
    },
    "@/lib/searchCache": { revalidateFeaturedMakerCaches() {}, revalidateListingSearchCaches() {} },
    "@/lib/stripe": { stripe: {} },
    "@/lib/checkoutStockReservationRepairState": { checkoutStockReservationRepairAction() {} },
    "@/lib/checkoutStockReservationAuthority": {
      restoreBuyerExpiredCheckoutStockReservation: absent,
      restoreSellerExpiredCheckoutStockReservation: absent,
      restoreCheckoutStockReservationFromWebhook: async (input) => {
        calls.restores.push(input);
        if (restoreError) throw restoreError;
        return restoreResult;
      },
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

test("a webhook restore delegates to the durable reservation authority exactly once", async () => {
  const { calls, exports } = subject();
  await exports.restoreUnorderedCheckoutStockOnce({
    eventId: "evt", claimGeneration: 1n, sessionId: "cs_lost", metadata: tagged,
  });
  assert.equal(calls.restores.length, 1);
  assert.equal(calls.restores[0].eventId, "evt");
  assert.equal(calls.restores[0].claimGeneration, 1n);
  assert.equal(calls.restores[0].sessionId, "cs_lost");
  assert.equal(calls.messages.length, 0);
  assert.equal(calls.lockReleases, 1);
});

test("a settled or pruned reservation never restores stock from caller metadata", async () => {
  for (const result of ["terminal", "absent"]) {
    const { calls, exports } = subject({
      restoreResult: { result, checkoutLockKey: null, stockVisibilityChanged: 0 },
    });
    await exports.restoreUnorderedCheckoutStockOnce({
      eventId: "evt", claimGeneration: 1n, sessionId: "cs_old", metadata: tagged,
    });
    assert.equal(calls.restores.length, 1);
    assert.equal(calls.messages.length, result === "absent" ? 1 : 0);
  }
});

test("a pre-reservation session is reported without trusting legacy stock metadata", async () => {
  const { calls, exports } = subject();
  await exports.restoreBuyerExpiredCheckoutStockOnce({
    buyerId: "buyer",
    sessionId: "cs_legacy",
    metadata: { listingId: "listing", quantity: "1" },
  });
  assert.equal(calls.restores.length, 0);
  assert.equal(calls.messages.length, 1);
  assert.equal(calls.messages[0].context.tags.source, "checkout_stock_restore_missing_reservation");
  assert.equal(calls.messages[0].context.tags.restoreSource, "buyer_expiry");
  assert.equal(calls.lockReleases, 1);
});

test("a durable reservation authority failure remains retryable", async () => {
  const { calls, exports } = subject({ restoreError: new Error("reservation restore failed") });
  await assert.rejects(
    exports.restoreUnorderedCheckoutStockOnce({
      eventId: "evt", claimGeneration: 1n, sessionId: "cs_orphan", metadata: tagged,
    }),
    /reservation restore failed/,
  );
  assert.equal(calls.messages.length, 0);
  assert.equal(calls.lockReleases, 0);
});
