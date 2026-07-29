import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729056000_prepare_case_staff_queue_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");
const body = sql.slice(
  sql.indexOf("AS $grainline_case_staff_queue$"),
  sql.indexOf("$grainline_case_staff_queue$;"),
);
const normalizedBody = body.replace(/\s+/g, " ");

test("staff queue preparation is compatible and does not activate Case RLS", () => {
  assert.match(sql, /Compatible PIN-gated staff Case queue projection/);
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment|User)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(
    normalizedSql,
    /REVOKE .* ON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment|User)"/,
  );
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
  assert.doesNotMatch(normalizedBody, /\b(?:INSERT|UPDATE|DELETE)\b/);
});

test("staff queue is one bounded fixed-shape SECURITY DEFINER operation", () => {
  assert.match(
    normalizedSql,
    /grainline_case_staff_queue\( p_actor_user_id text, p_status_filter text, p_requested_page integer, p_page_size integer \) RETURNS TABLE \( "totalCount" bigint, "safePage" integer, cases jsonb \) LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
  );
  assert.match(normalizedBody, /p_requested_page > 1000/);
  assert.match(normalizedBody, /p_page_size > 50/);
  assert.match(
    normalizedBody,
    /WITH filtered_rows AS NOT MATERIALIZED/,
  );
  assert.match(
    normalizedBody,
    /OFFSET \( \(SELECT pagination\.safe_page FROM pagination\) - 1 \) \* p_page_size LIMIT p_page_size/,
  );
  assert.match(
    normalizedBody,
    /ORDER BY filtered_row\."resolvedAt" ASC NULLS FIRST, filtered_row\."createdAt" DESC, filtered_row\.id DESC/,
  );
  assert.doesNotMatch(normalizedBody, /\bEXECUTE\b/i);
  assert.doesNotMatch(normalizedBody, /\bformat\s*\(/i);
});

test("staff queue derives active staff authority and transaction-local context", () => {
  assert.match(
    normalizedBody,
    /pg_catalog\.set_config\( 'app\.user_id', p_actor_user_id, true \)/,
  );
  assert.match(
    normalizedBody,
    /SELECT actor\.role, actor\.banned, actor\."deletedAt" INTO actor_role, actor_banned, actor_deleted_at/,
  );
  assert.match(
    normalizedBody,
    /actor_role NOT IN \( 'EMPLOYEE'::public\."Role", 'ADMIN'::public\."Role" \) THEN RETURN/,
  );
});

test("staff queue emits only minimal display fields and database-derived counts", () => {
  for (const key of [
    "id",
    "orderId",
    "buyerLabel",
    "buyerSecondaryEmail",
    "sellerLabel",
    "reason",
    "status",
    "messageCount",
    "createdAt",
  ]) {
    assert.match(normalizedBody, new RegExp(`'${key}'`));
  }
  assert.match(
    normalizedBody,
    /SELECT pg_catalog\.count\(\*\)::bigint FROM public\."CaseMessage"/,
  );
  assert.match(
    normalizedBody,
    /pg_catalog\.to_char\( projected_row\."createdAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS\.MS"Z"' \)/,
  );
  assert.match(
    normalizedBody,
    /FILTER \(WHERE projected_row\.id IS NOT NULL\)/,
  );
  assert.match(
    normalizedBody,
    /COALESCE\( NULLIF\(buyer\.name, ''\), buyer\.email, 'Deleted buyer' \)/,
  );
  assert.doesNotMatch(
    normalizedBody,
    /\b(?:clerkId|imageUrl|description|stripeRefundId|refundAmountCents|openedByPaymentEventId|resolvedById|directUploadId|objectKey)\b/,
  );
});

test("staff queue uses exact runtime grants and no public execute", () => {
  assert.match(
    normalizedSql,
    /REVOKE ALL ON FUNCTION public\.grainline_case_staff_queue\(text, text, integer, integer\) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_staff_queue\(text, text, integer, integer\) TO grainline_app_runtime/,
  );
});

test("PostgreSQL special forms remain unqualified", () => {
  assert.doesNotMatch(
    sql,
    /\bpg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
  );
});
