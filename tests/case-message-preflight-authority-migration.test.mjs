import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729053000_prepare_case_message_preflight_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");
const body = sql.slice(
  sql.indexOf("AS $grainline_case_message_preflight$"),
  sql.indexOf("$grainline_case_message_preflight$;"),
);

test("Case-message preflight is compatible and does not activate Case RLS", () => {
  assert.match(sql, /Compatible recipient-scoped preflight/);
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(
    normalizedSql,
    /REVOKE .* ON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"/,
  );
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
});

test("Case-message preflight is pinned source-validating DEFINER authority", () => {
  assert.match(
    normalizedSql,
    /grainline_case_message_preflight\( p_actor_user_id text, p_case_id text \) RETURNS TABLE \( "caseId" text, "orderId" text, "buyerUserId" text, "sellerUserId" text, status text, "authorKind" text, "actsAsStaff" boolean, "canCreateMessage" boolean, "recipientUnavailableReason" text \) LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON FUNCTION public\.grainline_case_message_preflight\(text, text\) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_message_preflight\(text, text\) TO grainline_app_runtime/,
  );
  assert.doesNotMatch(body, /\bEXECUTE\b/i);
  assert.doesNotMatch(body, /\bformat\s*\(/i);
});

test("Case-message preflight sets actor context and derives authority", () => {
  assert.match(
    normalizedSql,
    /set_config\( 'app\.user_id', p_actor_user_id, true \) <> p_actor_user_id/,
  );
  assert.match(
    normalizedSql,
    /SELECT actor\.role, actor\.banned, actor\."deletedAt" INTO actor_role, actor_banned, actor_deleted_at/,
  );
  assert.match(
    normalizedSql,
    /p_actor_user_id IN \( case_row\."buyerId", case_row\."sellerId" \) OR actor_role IN \( 'EMPLOYEE'::public\."Role", 'ADMIN'::public\."Role" \)/,
  );
  assert.match(
    normalizedSql,
    /WHEN p_actor_user_id = case_row\."buyerId" THEN 'BUYER'::text WHEN p_actor_user_id = case_row\."sellerId" THEN 'SELLER'::text ELSE 'STAFF'::text/,
  );
  assert.doesNotMatch(
    normalizedSql,
    /p_(?:role|author_kind|acts_as_staff|can_create|recipient|status)/i,
  );
});

test("Case-message preflight derives participant and staff messageable states", () => {
  assert.match(
    normalizedSql,
    /WHEN p_actor_user_id IN \( case_row\."buyerId", case_row\."sellerId" \) THEN case_row\.status IN \( 'OPEN'::public\."CaseStatus", 'IN_DISCUSSION'::public\."CaseStatus", 'PENDING_CLOSE'::public\."CaseStatus" \) ELSE case_row\.status IN \( 'OPEN'::public\."CaseStatus", 'IN_DISCUSSION'::public\."CaseStatus", 'PENDING_CLOSE'::public\."CaseStatus", 'UNDER_REVIEW'::public\."CaseStatus" \)/,
  );
});

test("Case-message preflight derives unavailable counterparty state", () => {
  for (const contract of [
    /WHEN seller\.id IS NULL THEN 'missing'::text/,
    /WHEN seller\."deletedAt" IS NOT NULL THEN 'deleted'::text/,
    /WHEN seller\.banned THEN 'suspended'::text/,
    /WHEN buyer\.id IS NULL THEN 'missing'::text/,
    /WHEN buyer\."deletedAt" IS NOT NULL THEN 'deleted'::text/,
    /WHEN buyer\.banned THEN 'suspended'::text/,
  ]) {
    assert.match(normalizedSql, contract);
  }
  assert.match(
    normalizedSql,
    /WHEN p_actor_user_id IS DISTINCT FROM case_row\."buyerId" AND p_actor_user_id IS DISTINCT FROM case_row\."sellerId" THEN NULL::text/,
  );
});

test("PostgreSQL special forms remain unqualified", () => {
  assert.doesNotMatch(
    sql,
    /\bpg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
  );
});
