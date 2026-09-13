import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migrationPath =
  "prisma/migrations/20260824030000_prepare_order_payment_signed_authority/migration.sql";
const sql = readFileSync(migrationPath, "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

test("adds nullable typed ordering without activating OrderPaymentEvent RLS", () => {
  assert.match(schema, /stripeEventCreatedSeconds\s+BigInt\?/);
  assert.match(
    schema,
    /@@index\(\[orderId, eventType, stripeObjectId, stripeEventCreatedSeconds\(sort: Desc\), id\(sort: Desc\)\]/,
  );
  assert.match(sql, /ADD COLUMN "stripeEventCreatedSeconds" bigint/);
  assert.match(sql, /OrderPaymentEvent_stripeEventCreatedSeconds_check/);
  assert.match(sql, /OrderPaymentEvent_order_dispute_event_time_idx/);
  assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /REVOKE ALL ON (?:TABLE|ALL TABLES)/);
});

test("refund writer binds the active source and derives its Order", () => {
  assert.match(sql, /grainline_order_payment_signed_refund_apply/);
  assert.match(sql, /source_event\.type IS DISTINCT FROM 'charge\.refunded'/);
  assert.match(sql, /source_event\."sourceObjectId" IS DISTINCT FROM p_charge_id/);
  assert.match(sql, /source_event\."claimGeneration" IS DISTINCT FROM p_claim_generation/);
  assert.match(sql, /source_event\."processingStartedAt" IS NULL/);
  assert.match(sql, /source_event\."processedAt" IS NOT NULL/);
  assert.match(sql, /orders\."stripeChargeId" = p_charge_id/);
  assert.doesNotMatch(sql, /p_order_id/);
  assert.match(sql, /Signed refund replay payload is inconsistent/);
  assert.match(sql, /'STRIPE_REFUND_RECORDED'/);
});

test("dispute writer retains stale and equal-second observations without unsafe effects", () => {
  assert.match(sql, /grainline_order_payment_signed_dispute_apply/);
  assert.match(sql, /source_event\.type NOT IN \(/);
  assert.match(sql, /source_event\."sourceObjectId" IS DISTINCT FROM p_dispute_id/);
  assert.match(sql, /'stale_recorded'/);
  assert.match(sql, /'same_second_recorded'/);
  assert.match(sql, /'conflict_recorded'/);
  assert.match(sql, /FROM public\."OrderPaymentEvent" AS equal_payment/);
  assert.match(sql, /equal_payment\.status IS DISTINCT FROM normalized_status/);
  assert.match(
    sql,
    /equal_payment\.metadata->>'stripeEventType'[\s\S]*IS DISTINCT FROM source_event\.type/,
  );
  assert.match(sql, /conflicting dispute states at the same provider second/);
  assert.match(sql, /IF source_event\.type = 'charge\.dispute\.created'/);
  assert.match(sql, /grainline_case_stripe_dispute_apply\(payment_event_id\)/);
  assert.match(sql, /'disputeSideEffectsApplied', should_apply/);
  assert.doesNotMatch(sql, /ORDER BY[\s\S]{0,300}"stripeEventId"/);
});

test("both families preserve the shared lock order and append typed evidence", () => {
  const refundStart = sql.indexOf("CREATE FUNCTION public.grainline_order_payment_signed_refund_apply");
  const disputeStart = sql.indexOf("CREATE FUNCTION public.grainline_order_payment_signed_dispute_apply");
  const refundBody = sql.slice(refundStart, disputeStart);
  const disputeBody = sql.slice(disputeStart);
  for (const body of [refundBody, disputeBody]) {
    assert.ok(body.indexOf('FROM public."StripeWebhookEvent"') >= 0);
    assert.ok(body.indexOf("pg_catalog.pg_advisory_xact_lock(913337") > body.indexOf('FROM public."StripeWebhookEvent"'));
    assert.ok(body.indexOf('FROM public."Order"') > body.indexOf("pg_catalog.pg_advisory_xact_lock(913337"));
    assert.match(body, /"stripeEventCreatedSeconds"/);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = pg_catalog/);
  }
});

test("fixed functions are runtime-only and no generic SQL authority is introduced", () => {
  for (const name of [
    "grainline_order_payment_signed_refund_apply",
    "grainline_order_payment_signed_dispute_apply",
  ]) {
    assert.match(
      sql,
      new RegExp(`REVOKE ALL ON FUNCTION\\s+public\\.${name}\\([\\s\\S]*?FROM PUBLIC, grainline_app_runtime`),
    );
    assert.match(
      sql,
      new RegExp(`GRANT EXECUTE ON FUNCTION\\s+public\\.${name}\\([\\s\\S]*?TO grainline_app_runtime`),
    );
  }
  assert.doesNotMatch(sql, /\bEXECUTE\s+[^\n]*\bformat\s*\(/i);
  assert.doesNotMatch(sql, /pg_catalog\.(?:greatest|least|nullif|coalesce)\b/i);
  assert.doesNotMatch(sql, /grainline_order_payment_(?:write|append|lookup|cleanup)\b/);
});
