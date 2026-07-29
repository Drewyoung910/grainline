import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729057000_prepare_case_order_active_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

function functionBody(name) {
  const marker = `$${name}$`;
  const start = sql.indexOf(`AS ${marker}`);
  const end = sql.indexOf(`${marker};`, start);
  assert.ok(start >= 0 && end > start, `${name} body is missing`);
  return sql.slice(start, end).replace(/\s+/g, " ");
}

const buyerBody = functionBody(
  "grainline_case_order_active_for_buyer",
);
const sellerBody = functionBody(
  "grainline_case_order_active_for_seller",
);
const pruneBody = functionBody(
  "grainline_order_buyer_pii_prune_batch",
);

test("Case-aware Order preparation remains compatible and does not activate RLS", () => {
  assert.match(sql, /Compatible Case-aware Order guards/);
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|Order|OrderShippingRateQuote)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(
    normalizedSql,
    /(?:GRANT|REVOKE).* ON TABLE public\."(?:Case|CaseMessage|Order|OrderShippingRateQuote)"/,
  );
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
});

test("buyer and seller predicates are separate fixed SECURITY DEFINER operations", () => {
  for (const functionName of [
    "grainline_case_order_active_for_buyer",
    "grainline_case_order_active_for_seller",
  ]) {
    assert.match(
      normalizedSql,
      new RegExp(
        `${functionName}\\( p_actor_user_id text, p_order_id text \\) RETURNS boolean LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog`,
      ),
    );
  }
  for (const body of [buyerBody, sellerBody]) {
    assert.match(body, /actor\.banned = false/);
    assert.match(body, /actor\."deletedAt" IS NULL/);
    assert.match(body, /case_row\."orderId" = p_order_id/);
    for (const status of [
      "OPEN",
      "IN_DISCUSSION",
      "PENDING_CLOSE",
      "UNDER_REVIEW",
    ]) {
      assert.match(body, new RegExp(`'${status}'::public\\."CaseStatus"`));
    }
    assert.doesNotMatch(body, /\b(?:set_config|current_setting)\s*\(/i);
    assert.doesNotMatch(body, /\b(?:INSERT|UPDATE|DELETE)\b/);
    assert.doesNotMatch(body, /\bEXECUTE\b/i);
    assert.doesNotMatch(body, /\bformat\s*\(/i);
  }
});

test("buyer predicate derives exact buyer ownership and fails closed", () => {
  assert.match(
    buyerBody,
    /order_row\."buyerId" = actor\.id/,
  );
  assert.match(buyerBody, /order_row\.id = p_order_id/);
  assert.match(buyerBody, /IF NOT actor_authorized THEN RETURN NULL/);
  assert.doesNotMatch(
    buyerBody,
    /"SellerProfile"|"OrderItem"|"Listing"/,
  );
});

test("seller predicate derives one complete seller-owned Order graph", () => {
  assert.match(
    sellerBody,
    /INNER JOIN public\."SellerProfile" AS seller ON seller\."userId" = actor\.id/,
  );
  assert.match(
    sellerBody,
    /EXISTS \( SELECT 1 FROM public\."OrderItem" AS order_item WHERE order_item\."orderId" = order_row\.id \)/,
  );
  assert.match(
    sellerBody,
    /NOT EXISTS \( SELECT 1 FROM public\."OrderItem" AS order_item INNER JOIN public\."Listing" AS listing ON listing\.id = order_item\."listingId" WHERE order_item\."orderId" = order_row\.id AND listing\."sellerId" <> seller\.id \)/,
  );
  assert.match(sellerBody, /IF NOT actor_authorized THEN RETURN NULL/);
});

test("fixed retention operation derives cutoff, targets and lock order internally", () => {
  assert.match(
    normalizedSql,
    /grainline_order_buyer_pii_prune_batch\( p_batch_size integer \) RETURNS TABLE \( purged bigint, cutoff timestamp without time zone \) LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
  );
  assert.match(pruneBody, /p_batch_size > 1000/);
  assert.match(
    pruneBody,
    /fixed_cutoff := \(pg_catalog\.clock_timestamp\(\) AT TIME ZONE 'UTC'\) - INTERVAL '90 days'/,
  );
  assert.match(
    pruneBody,
    /WITH pii_candidates AS MATERIALIZED \( SELECT order_row\.id FROM public\."Order" AS order_row/,
  );
  assert.match(
    pruneBody,
    /FOR UPDATE OF order_row SKIP LOCKED LIMIT p_batch_size/,
  );
  assert.match(
    pruneBody,
    /NOT EXISTS \( SELECT 1 FROM public\."Case" AS case_row WHERE case_row\."orderId" = order_row\.id/,
  );
  assert.match(
    pruneBody,
    /DELETE FROM public\."OrderShippingRateQuote" AS quote USING pii_candidates/,
  );
  assert.match(
    pruneBody,
    /UPDATE public\."Order" AS order_row SET "buyerEmail" = NULL/,
  );
  assert.match(
    pruneBody,
    /"buyerDataPurgedAt" = pg_catalog\.clock_timestamp\(\) AT TIME ZONE 'UTC'/,
  );
  assert.doesNotMatch(
    pruneBody,
    /\bp_(?:order|cutoff|retention|actor|user)_/,
  );
  assert.doesNotMatch(pruneBody, /\bEXECUTE\b/i);
  assert.doesNotMatch(pruneBody, /\bformat\s*\(/i);
});

test("all three operations have exact runtime grants and no public execution", () => {
  for (const signature of [
    "grainline_case_order_active_for_buyer\\(text, text\\)",
    "grainline_case_order_active_for_seller\\(text, text\\)",
    "grainline_order_buyer_pii_prune_batch\\(integer\\)",
  ]) {
    assert.match(
      normalizedSql,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${signature} FROM PUBLIC, grainline_app_runtime`,
      ),
    );
    assert.match(
      normalizedSql,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${signature} TO grainline_app_runtime`,
      ),
    );
  }
});

test("PostgreSQL special forms remain unqualified", () => {
  assert.doesNotMatch(
    sql,
    /\bpg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
  );
});
