import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const design = readFileSync("docs/order-payment-event-signed-authority-design.md", "utf8");
const strategy = readFileSync("STRATEGY.md", "utf8");
const normalizedStrategy = strategy.replaceAll(/\s+/g, " ");

test("signed payment authority has a narrow two-family boundary", () => {
  assert.match(design, /charge\.refunded/);
  for (const eventType of [
    "charge.dispute.created",
    "charge.dispute.updated",
    "charge.dispute.closed",
    "charge.dispute.funds_withdrawn",
    "charge.dispute.funds_reinstated",
  ]) {
    assert.match(design, new RegExp(eventType.replaceAll(".", "\\.")));
  }
  assert.match(design, /grainline_order_payment_signed_refund_apply/);
  assert.match(design, /grainline_order_payment_signed_dispute_apply/);
  assert.match(design, /does not authorize bundling ambiguous\nlocal-refund reconciliation/);
});

test("design pins fixed SECURITY DEFINER authority and an honest trust boundary", () => {
  assert.match(design, /SECURITY DEFINER/);
  assert.match(design, /SET search_path = pg_catalog/);
  assert.match(design, /contain no dynamic SQL/);
  assert.match(design, /PUBLIC.*revoked/s);
  assert.match(design, /grant `EXECUTE` only to `grainline_app_runtime`/);
  assert.match(design, /cannot independently prove cryptographic authenticity/);
  assert.match(design, /not evidence that a fully compromised\nruntime/);
  assert.match(design, /No function accepts a caller-selected `orderId`/);
  assert.match(design, /no generic append, arbitrary lookup, arbitrary Order update or cleanup/);
});

test("source binding, lock order and typed event ordering are explicit", () => {
  assert.match(design, /exact event ID, expected event type, expected source object ID/);
  assert.match(design, /source event row, charge advisory lock, Order row, then\ndispute-object advisory lock/);
  assert.match(design, /stripeEventCreatedSeconds bigint/);
  assert.match(design, /does not backfill a provider time from application `createdAt`/);
  assert.match(design, /event ID and not application arrival\ntime/);
  assert.match(design, /conflicting states at the same provider second are both retained/);
  assert.match(design, /must not throw after inserting evidence/);
});

test("application conversion and later release gates remain separate", () => {
  assert.match(design, /old `recordOrderPaymentEvent` path is removed for these\nsix event types/);
  assert.match(design, /post-commit\nbest-effort call is not accepted silently/);
  assert.match(design, /predecessor direct table authority and old\/new app\ncompatibility remain/);
  assert.match(design, /Policyless ENABLE,\ngrant revocation and FORCE remain later releases/);
  assert.match(
    design,
    /compatible candidate implemented, byte-pinned and merged through exact\nmain/,
  );
  assert.match(design, /20260824030000_prepare_order_payment_signed_authority/);
  assert.match(
    design,
    /176ad2c17301dd1d6bd9a1c0e190e8d44b15463ec830f9a67eb43ec3070396f2/,
  );
  assert.match(design, /production-applied through guarded run `32793394895`/);
  assert.match(design, /dpl_73aR913b9hfgkcdfBv2MwMyypR5a/);
  assert.match(design, /RLS and predecessor table\s+grants remain unchanged/);
  assert.match(design, /real signed-provider delivery\/retry proof is still\s+required/i);
  assert.match(design, /guarded Production\nMigrations workflow intentionally does not expose this candidate/);
});

test("strategy preserves the signed-family sequencing decision", () => {
  assert.match(normalizedStrategy, /signed platform-webhook authority/);
  assert.match(normalizedStrategy, /Do not bundle ambiguous local-refund reconciliation/);
  assert.match(normalizedStrategy, /Equal-provider-second conflicts retain evidence/);
});
