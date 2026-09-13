import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  resolveSingleCheckoutResume,
  singleCheckoutResumeSourceIsAvailable,
} = await import("../src/lib/singleCheckoutResume.ts");

function source(path) {
  return readFileSync(path, "utf8");
}

const expected = {
  buyerId: "buyer-1",
  listingId: "listing-1",
  sellerId: "seller-1",
  checkoutLockKey: "checkout:single:buyer-1:listing:listing-1",
};
const lock = {
  state: "ready",
  payloadHash: "a".repeat(32),
  sessionId: "cs_test_exact",
  clientSecret: "cs_test_exact_secret_value",
};
const session = {
  id: lock.sessionId,
  status: "open",
  payment_status: "unpaid",
  mode: "payment",
  ui_mode: "embedded",
  client_secret: lock.clientSecret,
  metadata: {
    buyerId: expected.buyerId,
    listingId: expected.listingId,
    sellerId: expected.sellerId,
    checkoutLockKey: expected.checkoutLockKey,
    checkoutPayloadHash: lock.payloadHash,
  },
};
const sourceListing = {
  status: "ACTIVE",
  isPrivate: true,
  reservedForUserId: expected.buyerId,
  seller: {
    id: expected.sellerId,
    userId: "seller-user-1",
    stripeAccountId: "acct_1",
    stripeAccountVersion: "v2",
    chargesEnabled: true,
    vacationMode: false,
    acceptingNewOrders: true,
    user: { banned: false, deletedAt: null },
  },
};

describe("single-checkout last-stock recovery", () => {
  it("returns only an exact buyer/listing-scoped open Session", () => {
    assert.deepEqual(resolveSingleCheckoutResume(lock, session, expected), {
      clientSecret: lock.clientSecret,
      sessionId: lock.sessionId,
      completedSessionId: null,
    });

    for (const drift of [
      { lock: { ...lock, state: "preparing" }, session, expected },
      { lock: { ...lock, payloadHash: "short" }, session, expected },
      { lock: { ...lock, payloadHash: "!".repeat(32) }, session, expected },
      { lock: { ...lock, sessionId: "not_checkout_session" }, session, expected },
      { lock: { ...lock, clientSecret: `${lock.sessionId}_secret_bad%2Gvalue` }, session, expected },
      { lock, session: { ...session, id: "cs_test_other" }, expected },
      { lock, session: { ...session, mode: "setup" }, expected },
      { lock, session: { ...session, ui_mode: "hosted" }, expected },
      { lock, session: { ...session, client_secret: "cs_test_exact_secret_other" }, expected },
      { lock, session: { ...session, client_secret: `${lock.sessionId}_secret_bad%2Gvalue` }, expected },
      { lock, session: { ...session, metadata: { ...session.metadata, buyerId: "buyer-2" } }, expected },
      { lock, session: { ...session, metadata: { ...session.metadata, listingId: "listing-2" } }, expected },
      { lock, session: { ...session, metadata: { ...session.metadata, sellerId: "seller-2" } }, expected },
      { lock, session: { ...session, metadata: { ...session.metadata, checkoutLockKey: "other" } }, expected },
      { lock, session: { ...session, metadata: { ...session.metadata, checkoutPayloadHash: "b".repeat(32) } }, expected },
      { lock, session: { ...session, status: "expired" }, expected },
      { lock, session: { ...session, payment_status: "no_payment_required" }, expected },
    ]) {
      assert.equal(resolveSingleCheckoutResume(drift.lock, drift.session, drift.expected), null);
    }
  });

  it("recognizes an exact completed Session without returning its client secret", () => {
    assert.deepEqual(resolveSingleCheckoutResume(lock, {
      ...session,
      status: "complete",
      payment_status: "paid",
      client_secret: null,
    }, expected), {
      clientSecret: null,
      sessionId: null,
      completedSessionId: lock.sessionId,
    });
  });

  it("accepts the same exact binding in Stripe live mode", () => {
    const liveLock = {
      ...lock,
      sessionId: "cs_live_exact",
      clientSecret: "cs_live_exact_secret_encoded%2Fvalue",
    };
    const liveSession = {
      ...session,
      id: liveLock.sessionId,
      client_secret: liveLock.clientSecret,
      metadata: { ...session.metadata, checkoutPayloadHash: liveLock.payloadHash },
    };
    assert.deepEqual(resolveSingleCheckoutResume(liveLock, liveSession, expected), {
      clientSecret: liveLock.clientSecret,
      sessionId: liveLock.sessionId,
      completedSessionId: null,
    });
  });

  it("ignores only reservation-held stock while preserving mutable source authority", () => {
    assert.equal(singleCheckoutResumeSourceIsAvailable(sourceListing, expected.buyerId), true);
    for (const candidate of [
      null,
      { ...sourceListing, isPrivate: undefined },
      { ...sourceListing, status: "HIDDEN" },
      { ...sourceListing, reservedForUserId: "buyer-2" },
      { ...sourceListing, seller: null },
      { ...sourceListing, seller: { ...sourceListing.seller, id: "" } },
      { ...sourceListing, seller: { ...sourceListing.seller, userId: "" } },
      { ...sourceListing, seller: { ...sourceListing.seller, userId: expected.buyerId } },
      { ...sourceListing, seller: { ...sourceListing.seller, stripeAccountId: null } },
      { ...sourceListing, seller: { ...sourceListing.seller, chargesEnabled: false } },
      { ...sourceListing, seller: { ...sourceListing.seller, vacationMode: true } },
      { ...sourceListing, seller: { ...sourceListing.seller, acceptingNewOrders: false } },
      { ...sourceListing, seller: { ...sourceListing.seller, stripeAccountVersion: "v1" } },
      { ...sourceListing, seller: { ...sourceListing.seller, user: { banned: true, deletedAt: null } } },
      { ...sourceListing, seller: { ...sourceListing.seller, user: { banned: false, deletedAt: new Date() } } },
    ]) {
      assert.equal(singleCheckoutResumeSourceIsAvailable(candidate, expected.buyerId), false);
    }
    assert.equal(singleCheckoutResumeSourceIsAvailable({ ...sourceListing, stockQuantity: 0 }, expected.buyerId), true);
  });

  it("checks an exact ready lock before rejecting newly unavailable stock", () => {
    const route = source("src/app/api/cart/checkout/single/route.ts");
    const readyLock = route.indexOf("const existingCheckoutLock = await getCheckoutLock(checkoutLockKeyValue)");
    const stockCheck = route.indexOf('if (listing.listingType === "IN_STOCK")');
    const newLock = route.indexOf("const checkoutLockOwnerTokenValue = await acquireCheckoutLock");
    assert.ok(readyLock > 0);
    assert.ok(stockCheck > readyLock);
    assert.ok(newLock > stockCheck);
    assert.match(route.slice(readyLock, stockCheck), /existingCheckoutLock\.payloadHash === payloadHash/);
    assert.match(route.slice(readyLock, stockCheck), /reused: true/);
  });

  it("keeps the resume route buyer-, listing-, lock- and Stripe-bound", () => {
    const route = source("src/app/api/cart/checkout/single/resume/route.ts");
    assert.match(route, /const \{ userId \} = await auth\(\)/);
    assert.match(route, /ensureUserByClerkId\(userId\)/);
    assert.match(route, /singleCheckoutLockKey\(me\.id, listingId\)/);
    assert.match(route, /prisma\.listing\.findUnique/);
    assert.match(route, /singleCheckoutResumeSourceIsAvailable\(listing, me\.id\)/);
    assert.match(route, /stripe\.checkout\.sessions\.retrieve\(lock\.sessionId\)/);
    assert.match(route, /resolveSingleCheckoutResume\(lock, session/);
    assert.match(route, /sellerId: listing\.seller\.id/);
    assert.match(route, /privateJson\(resumed \?\? EMPTY_RESUME\)/);
    assert.doesNotMatch(route, /stockQuantity/);
    assert.doesNotMatch(source("src/lib/singleCheckoutResume.ts"), /stockQuantity/);
    assert.ok(route.indexOf("getCheckoutLock(checkoutLockKey)") < route.indexOf("prisma.listing.findUnique"));
  });

  it("resumes a Buy Now payment before requesting a fresh shipping quote", () => {
    const modal = source("src/components/BuyNowCheckoutModal.tsx");
    assert.match(modal, /api\/cart\/checkout\/single\/resume\?listingId=/);
    assert.match(modal, /sessionIdRef\.current = data\.sessionId/);
    assert.match(modal, /setClientSecret\(data\.clientSecret\)/);
    assert.match(modal, /setStep\("payment"\)/);

    const operator = source("scripts/order-payment-event-blocked-checkout-production-proof.mjs");
    const activeBranch = operator.indexOf("if (beforeHistory.active) {");
    const freshBranch = operator.indexOf("} else {", activeBranch);
    assert.ok(activeBranch > 0 && freshBranch > activeBranch);
    assert.match(operator.slice(activeBranch, freshBranch), /resumeSingleCheckout/);
    assert.doesNotMatch(operator.slice(activeBranch, freshBranch), /signedPickupRate/);
    assert.match(operator.slice(freshBranch, operator.indexOf("const afterHistory", freshBranch)), /signedPickupRate/);
  });
});
