import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729050000_prepare_case_participant_resolution_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

test("participant resolution authority is compatible and does not activate Case RLS", () => {
  assert.match(sql, /Compatible fixed authority/);
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(normalizedSql, /REVOKE .* ON TABLE public\."Case"/);
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
});

test("mark-resolved is pinned, fixed, and runtime-executable only", () => {
  assert.match(
    normalizedSql,
    /grainline_case_mark_resolved\( p_actor_user_id text, p_case_id text \) RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON FUNCTION public\.grainline_case_mark_resolved\(text, text\) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_mark_resolved\(text, text\) TO grainline_app_runtime/,
  );
  const body = sql.slice(
    sql.indexOf("AS $grainline_case_mark_resolved$"),
    sql.indexOf("$grainline_case_mark_resolved$;"),
  );
  assert.doesNotMatch(body, /\bEXECUTE\b/i);
  assert.doesNotMatch(body, /\bformat\s*\(/i);
});

test("mark-resolved uses the shared actor, Order, Case lock order", () => {
  const actorLock = normalizedSql.indexOf(
    'FROM public."User" AS actor WHERE actor.id = p_actor_user_id FOR SHARE',
  );
  const orderLock = normalizedSql.indexOf(
    'FROM public."Order" AS orders WHERE orders.id = source_order_id FOR UPDATE',
  );
  const caseLock = normalizedSql.indexOf(
    'FROM public."Case" AS case_row WHERE case_row.id = p_case_id AND case_row."orderId" = locked_order.id FOR UPDATE',
  );
  assert.ok(actorLock >= 0);
  assert.ok(orderLock > actorLock);
  assert.ok(caseLock > orderLock);
});

test("mark-resolved derives participant side, transition, clock, and audit", () => {
  assert.match(
    normalizedSql,
    /actor_is_buyer := COALESCE\( locked_case\."buyerId" = locked_actor\.id, false \)/,
  );
  assert.match(
    normalizedSql,
    /actor_is_seller := COALESCE\( locked_case\."sellerId" = locked_actor\.id, false \)/,
  );
  assert.match(
    normalizedSql,
    /next_buyer_marked := locked_case\."buyerMarkedResolved" OR actor_is_buyer/,
  );
  assert.match(
    normalizedSql,
    /WHEN next_buyer_marked AND next_seller_marked THEN 'RESOLVED'::public\."CaseStatus" ELSE 'PENDING_CLOSE'/,
  );
  assert.match(
    normalizedSql,
    /transition_at := pg_catalog\.timezone\( 'UTC', pg_catalog\.clock_timestamp\(\) \)/,
  );
  assert.match(
    normalizedSql,
    /INSERT INTO public\."AdminAuditLog"[\s\S]*'MARK_CASE_RESOLVED'[\s\S]*'actorKind', 'user'/,
  );
  assert.match(
    normalizedSql,
    /'auditLogId', audit_id,[\s\S]*'action', 'updated'/,
  );
});

test("mark-resolved fences refunds and every staged staff claim", () => {
  assert.match(
    normalizedSql,
    /locked_order\."sellerRefundId" IS NOT NULL OR locked_order\."caseResolutionClaimId" IS NOT NULL/,
  );
  assert.match(
    normalizedSql,
    /Case resolution-mark conflicts with refund or staff state/,
  );
  assert.ok(
    normalizedSql.indexOf(
      'FROM public."Order" AS orders WHERE orders.id = source_order_id FOR UPDATE',
    ) < normalizedSql.indexOf(
      'locked_order."caseResolutionClaimId" IS NOT NULL',
    ),
  );
});

test("mark-resolved retry reuses one deterministic notification authority source", () => {
  assert.match(
    normalizedSql,
    /audit_id := 'case_resolution_mark_' \|\| pg_catalog\.md5\(locked_case\.id \|\| ':' \|\| locked_actor\.id\)/,
  );
  assert.match(
    normalizedSql,
    /IF \(actor_is_buyer AND locked_case\."buyerMarkedResolved"\) OR \(actor_is_seller AND locked_case\."sellerMarkedResolved"\) THEN/,
  );
  assert.match(
    normalizedSql,
    /existing_audit\.metadata->>'status' IS NULL OR existing_audit\.metadata->>'status' NOT IN \( 'PENDING_CLOSE', 'RESOLVED' \)/,
  );
  assert.match(normalizedSql, /result_action := 'replay'/);
  assert.match(normalizedSql, /result_action := 'legacy_recovered'/);
});
