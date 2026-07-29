import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729044000_prepare_case_seller_refund_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

test("Case seller-refund authority is a compatible private-ledger release", () => {
  assert.match(sql, /Compatible fixed authority/);
  assert.match(
    normalizedSql,
    /CREATE TABLE public\."CaseSellerRefundApplication"/,
  );
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(normalizedSql, /REVOKE .* ON TABLE public\."Case"/);
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
});

test("Case seller-refund authority is CI-reviewed but not production-authorized", () => {
  const ciWorkflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const productionWorkflow = fs.readFileSync(
    ".github/workflows/production-migrations.yml",
    "utf8",
  );
  assert.match(
    ciWorkflow,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: case-account-export-authority-reviewed/,
  );
  assert.match(
    productionWorkflow,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: direct-upload-legacy-repair-reviewed/,
  );
  assert.doesNotMatch(
    productionWorkflow,
    /case-(?:resolution-claim-preparation|stripe-dispute-authority|seller-refund-authority)-reviewed/,
  );
});

test("the fixed function accepts only actor plus one exact local refund source", () => {
  assert.match(
    normalizedSql,
    /grainline_case_seller_refund_apply\( p_actor_user_id text, p_order_payment_event_id text \)/,
  );
  assert.deepEqual(
    [...new Set(normalizedSql.match(/\bp_[a-z0-9_]+\b/gi) ?? [])],
    ["p_actor_user_id", "p_order_payment_event_id"],
  );
  for (const sourceCheck of [
    /source_event\."eventType" <> 'REFUND'/,
    /source_event\."stripeObjectType" IS DISTINCT FROM 'refund'/,
    /'local:seller_refund_recorded:' \|\| source_event\."stripeObjectId"/,
    /source_event\.metadata->>'localAction' IS DISTINCT FROM 'SELLER_REFUND_RECORDED'/,
    /pg_catalog\.jsonb_typeof\(source_event\.metadata\) IS DISTINCT FROM 'object'/,
    /source_event\.metadata->>'refundType' IS NULL/,
    /source_event\.metadata->>'refundType' NOT IN \('FULL', 'PARTIAL'\)/,
    /pg_catalog\.jsonb_typeof\(source_event\.metadata->'refundIds'\) IS DISTINCT FROM 'array'/,
    /locked_order\."sellerRefundId" IS DISTINCT FROM source_event\."stripeObjectId"/,
    /locked_order\."sellerRefundAmountCents" IS DISTINCT FROM source_event\."amountCents"/,
    /locked_order\."sellerRefundLockedAt" IS NOT NULL/,
  ]) {
    assert.match(normalizedSql, sourceCheck);
  }
});

test("the function locks actor then Order, source, seller graph and Case", () => {
  const actorLock = normalizedSql.indexOf(
    'FROM public."User" AS actor WHERE actor.id = p_actor_user_id FOR SHARE',
  );
  const sourceRead = normalizedSql.indexOf(
    'FROM public."OrderPaymentEvent" AS payment_event WHERE payment_event.id = p_order_payment_event_id',
  );
  const orderLock = normalizedSql.indexOf(
    'FROM public."Order" AS orders WHERE orders.id = source_order_id FOR UPDATE',
  );
  const sourceLock = normalizedSql.indexOf(
    'FROM public."OrderPaymentEvent" AS payment_event WHERE payment_event.id = p_order_payment_event_id AND payment_event."orderId" = locked_order.id FOR SHARE',
  );
  const sellerLocks = normalizedSql.indexOf(
    "ORDER BY item.id, listing.id, seller.id FOR SHARE OF item, listing, seller",
  );
  const caseLock = normalizedSql.indexOf(
    'FROM public."Case" AS case_row WHERE case_row."orderId" = locked_order.id FOR UPDATE',
  );
  assert.ok(actorLock >= 0);
  assert.ok(sourceRead > actorLock);
  assert.ok(orderLock > sourceRead);
  assert.ok(sourceLock > orderLock);
  assert.ok(sellerLocks > sourceLock);
  assert.ok(caseLock > sellerLocks);
  assert.match(
    normalizedSql,
    /locked_actor\.id IS DISTINCT FROM only_seller_user_id/,
  );
  assert.match(
    normalizedSql,
    /existing_case\."sellerId" IS DISTINCT FROM only_seller_user_id/,
  );
  assert.match(
    normalizedSql,
    /existing_case\."buyerId" IS DISTINCT FROM locked_order\."buyerId"/,
  );
});

test("refund amount and resolution are derived from the locked source", () => {
  assert.match(
    normalizedSql,
    /order_total_cents := COALESCE\(locked_order\."itemsSubtotalCents", 0\)::bigint \+ COALESCE\(locked_order\."shippingAmountCents", 0\)::bigint \+ COALESCE\(locked_order\."giftWrappingPriceCents", 0\)::bigint \+ COALESCE\(locked_order\."taxAmountCents", 0\)::bigint/,
  );
  assert.match(
    normalizedSql,
    /source_event\.metadata->>'refundType' = 'FULL' AND source_event\."amountCents"::bigint <> order_total_cents/,
  );
  assert.match(
    normalizedSql,
    /CASE source_event\.metadata->>'refundType' WHEN 'FULL' THEN 'REFUND_FULL'::public\."CaseResolution" ELSE 'REFUND_PARTIAL'::public\."CaseResolution" END/,
  );
  assert.match(
    normalizedSql,
    /"refundAmountCents" = source_event\."amountCents"/,
  );
  assert.match(
    normalizedSql,
    /"stripeRefundId" = source_event\."stripeObjectId"/,
  );
  assert.match(normalizedSql, /"resolvedById" = only_seller_user_id/);
  assert.match(normalizedSql, /"buyerMarkedResolved" = false/);
  assert.match(normalizedSql, /"sellerMarkedResolved" = false/);
});

test("terminal and resolved applications are immutable replays", () => {
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."CaseSellerRefundApplication" ENABLE ROW LEVEL SECURITY/,
  );
  assert.match(
    normalizedSql,
    /ALTER TABLE public\."CaseSellerRefundApplication" FORCE ROW LEVEL SECURITY/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON TABLE public\."CaseSellerRefundApplication" FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /FROM public\."CaseSellerRefundApplication" AS application WHERE application\."paymentEventId" = source_event\.id FOR SHARE/,
  );
  assert.match(
    normalizedSql,
    /existing_application\.action NOT IN \('resolve', 'terminal'\)/,
  );
  assert.ok(
    normalizedSql.indexOf("'replay'::text")
      < normalizedSql.indexOf("target_action := 'terminal'"),
    "an already-consumed refund source must replay before terminal handling",
  );
  assert.match(
    normalizedSql,
    /CHECK \(action IN \('resolve', 'terminal'\)\)/,
  );
  assert.match(
    normalizedSql,
    /INSERT INTO public\."CaseSellerRefundApplication"/,
  );
});

test("the function is pinned SECURITY DEFINER with only runtime execute", () => {
  const functionBody = sql.match(
    /AS \$grainline_case_seller_refund_apply\$([\s\S]*?)\$grainline_case_seller_refund_apply\$;/,
  )?.[1] ?? "";
  assert.match(
    normalizedSql,
    /LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON FUNCTION public\.grainline_case_seller_refund_apply\(text, text\) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_seller_refund_apply\(text, text\) TO grainline_app_runtime/,
  );
  assert.doesNotMatch(functionBody, /\bEXECUTE\b/i);
  assert.doesNotMatch(functionBody, /\bformat\s*\(/i);
});
