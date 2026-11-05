import assert from "node:assert/strict";
import test from "node:test";
import { checkoutRouteFixture as fixture } from "./helpers/checkout-route-fixture.mjs";
import { stripeRefusedCheckoutSessionCreate } from "../src/lib/checkoutLockState.ts";

const refused = (type, statusCode = 400, headers = {}) =>
  Object.assign(new Error("refused"), { type, statusCode, headers });

for (const [label, path, maxDurationMs] of [
  ["Buy Now", "src/app/api/cart/checkout/single/route.ts", 60_000],
  ["cart", "src/app/api/cart/checkout-seller/route.ts", 60_000],
]) {
  test(`${label}: when Stripe refuses the session, the stock and lock come back at once`, async () => {
    const subject = fixture(path, {
      createSession: async () => {
        throw refused("StripeInvalidRequestError");
      },
    });
    const response = await subject.post();
    assert.equal(response.status, 500);
    assert.equal(subject.state.aborts, 1);
    assert.equal(subject.state.lockReleases, 1);
  });

  test(`${label}: when Stripe's answer is lost, a session may exist, so the hold stays`, async () => {
    const subject = fixture(path, {
      createSession: async () => {
        throw Object.assign(new Error("socket hang up"), { type: "StripeConnectionError" });
      },
    });
    const response = await subject.post();
    assert.equal(response.status, 500);
    assert.equal(subject.state.aborts, 0);
    assert.equal(subject.state.lockReleases, 0);
  });

  test(`${label}: a hung Stripe call fails inside the route's time limit`, async () => {
    const subject = fixture(path);
    assert.equal((await subject.post()).status, 200);
    const { timeout, maxNetworkRetries, idempotencyKey } = subject.state.createOptions;
    assert.ok(timeout * (maxNetworkRetries + 1) < maxDurationMs);
    assert.ok(idempotencyKey);
  });
}

for (const path of ["src/app/api/cart/checkout/single/route.ts", "src/app/api/cart/checkout-seller/route.ts"]) {
  test(`${path}: a lock with no session says the last checkout didn't start`, async () => {
    const subject = fixture(path, {
      existingLock: { state: "preparing", payloadHash: "other", ownerToken: "token", createdAt: 1 },
    });
    const response = await subject.post();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "Your last checkout didn't start. Try again in a few minutes.");
  });

  test(`${path}: a reservation still active after its lock expired is a 409, not a 500`, async () => {
    const subject = fixture(path, { reserveError: Object.assign(new Error("duplicate"), { sqlState: "23505" }) });
    const response = await subject.post();
    assert.equal(response.status, 409);
    assert.equal((await response.json()).error, "Your last checkout didn't start. Try again in a few minutes.");
  });
}

test("only a 400 or 404 rejection counts as creating nothing", () => {
  assert.equal(stripeRefusedCheckoutSessionCreate(refused("StripeInvalidRequestError", 400)), true);
  assert.equal(stripeRefusedCheckoutSessionCreate(refused("StripeInvalidRequestError", 404)), true);
  for (const error of [
    refused("StripeInvalidRequestError", 400, { "stripe-should-retry": "true" }),
    refused("StripeInvalidRequestError", 409),
    refused("StripeRateLimitError", 429),
    refused("StripeConnectionError", undefined),
    refused("StripeAPIError", 500),
    refused("StripeIdempotencyError", 400),
    new Error("no type"),
    null,
  ]) {
    assert.equal(stripeRefusedCheckoutSessionCreate(error), false);
  }
});
