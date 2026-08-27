import assert from "node:assert/strict";
import test from "node:test";

const {
  CHECKOUT_TRANSFER_RETRY_DELAYS_MS,
  resolveCheckoutPaymentIntentRefs,
} = await import("../src/lib/checkoutPaymentIntentRefs.ts");

test("checkout payment refs return an already-visible destination transfer", async () => {
  let retrieveCount = 0;
  const result = await resolveCheckoutPaymentIntentRefs({
    payment_intent: {
      id: "pi_exact",
      latest_charge: {
        id: "ch_exact",
        application_fee: null,
        transfer: "tr_exact",
      },
    },
  }, {
    retrievePaymentIntent: async () => {
      retrieveCount += 1;
      throw new Error("provider retry must not run");
    },
    retrieveCharge: async () => {
      throw new Error("expanded Charge must not be re-retrieved");
    },
  });

  assert.deepEqual(result, {
    paymentIntentId: "pi_exact",
    stripeChargeId: "ch_exact",
    stripeApplicationFeeId: null,
    stripeTransferId: "tr_exact",
  });
  assert.equal(retrieveCount, 0);
});

test("checkout payment refs recover a destination transfer within the bounded consistency window", async () => {
  const waits = [];
  const expands = [];
  let retrieveCount = 0;
  const result = await resolveCheckoutPaymentIntentRefs({
    payment_intent: {
      id: "pi_delayed",
      latest_charge: { id: "ch_delayed", transfer: null },
    },
  }, {
    retryDelaysMs: [0, 7, 11],
    wait: async (milliseconds) => waits.push(milliseconds),
    retrievePaymentIntent: async (paymentIntentId, params) => {
      assert.equal(paymentIntentId, "pi_delayed");
      expands.push(params.expand);
      retrieveCount += 1;
      return {
        id: "pi_delayed",
        latest_charge: {
          id: "ch_delayed",
          application_fee: "fee_delayed",
          transfer: retrieveCount < 3 ? null : { id: "tr_delayed" },
        },
      };
    },
    retrieveCharge: async () => {
      throw new Error("expanded Charge must not be re-retrieved");
    },
  });

  assert.equal(retrieveCount, 3);
  assert.deepEqual(waits, [7, 11]);
  assert.deepEqual(expands, [
    ["latest_charge.transfer"],
    ["latest_charge.transfer"],
    ["latest_charge.transfer"],
  ]);
  assert.deepEqual(result, {
    paymentIntentId: "pi_delayed",
    stripeChargeId: "ch_delayed",
    stripeApplicationFeeId: "fee_delayed",
    stripeTransferId: "tr_delayed",
  });
});

test("checkout payment refs remain transfer-null after the bounded window", async () => {
  let retrieveCount = 0;
  const result = await resolveCheckoutPaymentIntentRefs({
    payment_intent: "pi_missing_transfer",
  }, {
    retryDelaysMs: [0, 1],
    wait: async () => {},
    retrievePaymentIntent: async () => {
      retrieveCount += 1;
      return {
        id: "pi_missing_transfer",
        latest_charge: "ch_missing_transfer",
      };
    },
    retrieveCharge: async (chargeId, params) => {
      assert.equal(chargeId, "ch_missing_transfer");
      assert.deepEqual(params.expand, ["transfer"]);
      return { id: chargeId, transfer: null };
    },
  });

  assert.equal(retrieveCount, 2);
  assert.deepEqual(result, {
    paymentIntentId: "pi_missing_transfer",
    stripeChargeId: "ch_missing_transfer",
    stripeApplicationFeeId: null,
    stripeTransferId: null,
  });
});

test("checkout transfer retry defaults stay short and bounded", () => {
  assert.deepEqual(CHECKOUT_TRANSFER_RETRY_DELAYS_MS, [0, 250, 750, 1_500]);
  assert.ok(CHECKOUT_TRANSFER_RETRY_DELAYS_MS.reduce((sum, value) => sum + value, 0) <= 3_000);
});

test("checkout transfer retries reject unbounded delay schedules", async () => {
  await assert.rejects(
    resolveCheckoutPaymentIntentRefs({ payment_intent: "pi_invalid" }, {
      retryDelaysMs: [6_000],
      retrievePaymentIntent: async () => ({}),
      retrieveCharge: async () => ({}),
    }),
    /retry delays are invalid/,
  );
});
