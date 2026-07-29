import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729043000_prepare_case_stripe_dispute_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

test("Case Stripe dispute authority is a compatible private-ledger release", () => {
  assert.match(sql, /Compatible fixed authority/);
  assert.match(
    normalizedSql,
    /CREATE TABLE public\."CaseStripeDisputeApplication"/,
  );
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(normalizedSql, /REVOKE .* ON TABLE public\."Case"/);
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
});

test("Case Stripe dispute authority is CI-reviewed but not production-authorized", () => {
  const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const productionWorkflow = fs.readFileSync(
    ".github/workflows/production-migrations.yml",
    "utf8",
  );
  assert.match(
    ciWorkflow,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: case-reply-authority-reviewed/,
  );
  assert.match(
    productionWorkflow,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: direct-upload-legacy-repair-reviewed/,
  );
  assert.doesNotMatch(
    productionWorkflow,
    /case-(?:resolution-claim-preparation|stripe-dispute-authority)-reviewed/,
  );
});

test("the fixed function accepts only one exact durable source", () => {
  assert.match(
    normalizedSql,
    /grainline_case_stripe_dispute_apply\( p_order_payment_event_id text \)/,
  );
  assert.match(
    normalizedSql,
    /source_event\."eventType" <> 'DISPUTE'/,
  );
  assert.match(
    normalizedSql,
    /source_event\.metadata->>'stripeEventType' IS DISTINCT FROM 'charge\.dispute\.created'/,
  );
  assert.match(
    normalizedSql,
    /source_event\.metadata->>'chargeId' IS DISTINCT FROM locked_order\."stripeChargeId"/,
  );
  assert.match(
    normalizedSql,
    /source_event\.metadata->>'disputeId' IS DISTINCT FROM source_event\."stripeObjectId"/,
  );
  assert.match(
    normalizedSql,
    /source_event\.metadata->>'stripeEventCreated' !~ '\^\[0-9\]\{1,12\}\$'/,
  );
  assert.deepEqual(
    [...new Set(normalizedSql.match(/\bp_[a-z0-9_]+\b/gi) ?? [])],
    ["p_order_payment_event_id"],
  );
});

test("valid but superseded dispute sources fail closed", () => {
  assert.match(
    normalizedSql,
    /ORDER BY \(payment_event\.metadata->>'stripeEventCreated'\)::bigint DESC/,
  );
  assert.match(
    normalizedSql,
    /latest_event\.stripe_event_created > source_event_created/,
  );
  assert.match(
    normalizedSql,
    /RAISE EXCEPTION 'Case Stripe dispute source is superseded'/,
  );
  assert.ok(
    normalizedSql.indexOf("'replay'::text")
      < normalizedSql.indexOf(
        "RAISE EXCEPTION 'Case Stripe dispute source is superseded'",
      ),
    "an already-applied source must replay before stale-source rejection",
  );
  for (const closedStatus of ["won", "lost", "prevented", "warning_closed"]) {
    assert.match(normalizedSql, new RegExp(`'${closedStatus}'`));
  }
});

test("the fixed function follows source to Order to Case locks", () => {
  const sourceRead = normalizedSql.indexOf(
    'FROM public."OrderPaymentEvent" AS payment_event WHERE payment_event.id = p_order_payment_event_id',
  );
  const orderLock = normalizedSql.indexOf(
    'FROM public."Order" AS orders WHERE orders.id = source_order_id FOR UPDATE',
  );
  const sourceLock = normalizedSql.indexOf(
    'FROM public."OrderPaymentEvent" AS payment_event WHERE payment_event.id = p_order_payment_event_id AND payment_event."orderId" = locked_order.id FOR SHARE',
  );
  const caseLock = normalizedSql.indexOf(
    'FROM public."Case" AS case_row WHERE case_row."orderId" = locked_order.id FOR UPDATE',
  );
  assert.ok(sourceRead >= 0);
  assert.ok(orderLock > sourceRead);
  assert.ok(sourceLock > orderLock);
  assert.ok(caseLock > sourceLock);
  assert.match(
    normalizedSql,
    /ORDER BY item\.id, listing\.id, seller\.id FOR SHARE OF item, listing, seller/,
  );
});

test("reopen clears the complete stale terminal snapshot", () => {
  const update = normalizedSql.match(
    /UPDATE public\."Case" AS case_row SET ([\s\S]*?) WHERE case_row\.id = target_case_id/,
  )?.[1] ?? "";
  for (const assignment of [
    "status = 'UNDER_REVIEW'::public.\"CaseStatus\"",
    "resolution = NULL",
    '"refundAmountCents" = NULL',
    '"stripeRefundId" = NULL',
    '"resolvedAt" = NULL',
    '"resolvedById" = NULL',
    '"buyerMarkedResolved" = false',
    '"sellerMarkedResolved" = false',
  ]) {
    assert.match(update, new RegExp(assignment.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
});

test("a private immutable application ledger makes replay non-mutating", () => {
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."CaseStripeDisputeApplication" ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."CaseStripeDisputeApplication" FORCE ROW LEVEL SECURITY/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON TABLE public\."CaseStripeDisputeApplication" FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /FROM public\."CaseStripeDisputeApplication" AS application WHERE application\."paymentEventId" = source_event\.id FOR SHARE/,
  );
  assert.match(
    normalizedSql,
    /INSERT INTO public\."CaseStripeDisputeApplication"/,
  );
  assert.match(
    normalizedSql,
    /RETURN QUERY SELECT existing_application\."caseId"::text,.*'replay'::text; RETURN;/s,
  );
  assert.doesNotMatch(normalizedSql, /ON CONFLICT \(id\) DO NOTHING/);
});

test("the function is pinned SECURITY DEFINER with only runtime execute", () => {
  const functionBody = sql.match(
    /AS \$grainline_case_stripe_dispute_apply\$([\s\S]*?)\$grainline_case_stripe_dispute_apply\$;/,
  )?.[1] ?? "";
  assert.match(normalizedSql, /LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/);
  assert.match(
    normalizedSql,
    /REVOKE ALL ON FUNCTION public\.grainline_case_stripe_dispute_apply\(text\) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_stripe_dispute_apply\(text\) TO grainline_app_runtime/,
  );
  assert.doesNotMatch(functionBody, /\bEXECUTE\b/i);
  assert.doesNotMatch(functionBody, /\bformat\s*\(/i);
});
