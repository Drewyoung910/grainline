import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Stripe from "stripe";
import { constructPrimaryStripeWebhookEvent } from "../src/lib/stripeWebhookSignatureRotation.mjs";

const stripe = new Stripe("sk_test_signature_fixture");
const payload = JSON.stringify({ id: "evt_rotation_fixture", object: "event",
  type: "payment_intent.succeeded", created: Math.floor(Date.now() / 1000) });
const primarySecret = "whsec_primary_fixture", nextSecret = "whsec_next_fixture";
const constructEvent = (body, signature, secret) => stripe.webhooks.constructEvent(body, signature, secret);
const header = secret => stripe.webhooks.generateTestHeaderString({ payload, secret });

test("primary and replacement signatures both verify against the same raw payload during overlap", () => {
  for (const secret of [primarySecret, nextSecret]) {
    const event = constructPrimaryStripeWebhookEvent({ body: payload, signature: header(secret),
      primarySecret, nextSecret, constructEvent });
    assert.equal(event.id, "evt_rotation_fixture");
  }
});

test("without overlap only the configured primary secret verifies", () => {
  assert.equal(constructPrimaryStripeWebhookEvent({ body: payload, signature: header(primarySecret),
    primarySecret, constructEvent }).id, "evt_rotation_fixture");
  assert.throws(() => constructPrimaryStripeWebhookEvent({ body: payload,
    signature: header(nextSecret), primarySecret, constructEvent }), /signature is invalid/u);
});

test("unrelated, tampered and missing signatures never reach an event", () => {
  for (const [signature, body] of [
    [header("whsec_unrelated_fixture"), payload],
    [header(primarySecret), `${payload} `],
    ["", payload],
  ]) {
    assert.throws(() => constructPrimaryStripeWebhookEvent({ body, signature,
      primarySecret, nextSecret, constructEvent }), /signature is invalid/u);
  }
});

test("duplicate or empty overlap configuration fails before signature verification", () => {
  let calls = 0;
  for (const next of ["", primarySecret]) {
    assert.throws(() => constructPrimaryStripeWebhookEvent({ body: payload,
      signature: header(primarySecret), primarySecret, nextSecret: next,
      constructEvent: () => { calls++; } }), /configuration is invalid/u);
  }
  assert.equal(calls, 0);
});

test("only the primary platform route opts into the temporary second secret", () => {
  const primary = fs.readFileSync("src/app/api/stripe/webhook/route.ts", "utf8");
  const connect = fs.readFileSync("src/app/api/stripe/webhook/connect/route.ts", "utf8");
  const v2 = fs.readFileSync("src/app/api/stripe/webhook/v2/route.ts", "utf8");
  assert.match(primary, /constructPrimaryStripeWebhookEvent\(\{ body, signature, primarySecret: secret,/u);
  assert.match(primary, /process\.env\.STRIPE_WEBHOOK_SECRET_NEXT/u);
  for (const other of [connect, v2]) assert.doesNotMatch(other, /STRIPE_WEBHOOK_SECRET_NEXT/u);
});
