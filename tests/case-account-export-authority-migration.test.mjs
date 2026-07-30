import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729059000_prepare_case_account_export_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalized = sql.replace(/\s+/g, " ");

test("Case account-export preparation is compatible and bounded", () => {
  assert.match(sql, /Compatible bounded participant Case export projection/);
  assert.doesNotMatch(
    normalized,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(
    normalized,
    /(?:GRANT|REVOKE).* ON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"/,
  );
  assert.doesNotMatch(normalized, /CREATE POLICY|INSERT INTO|UPDATE public|DELETE FROM/);
  assert.match(
    normalized,
    /grainline_case_export_page\( p_actor_user_id text, p_cursor_created_at timestamp\(3\), p_cursor_id text, p_limit integer \)/,
  );
  assert.match(normalized, /p_limit > 25/);
  assert.match(
    normalized,
    /ORDER BY case_row\."createdAt" DESC, case_row\.id DESC LIMIT p_limit/,
  );
});

test("Case account export is an exact participant-only INVOKER projection", () => {
  assert.match(
    normalized,
    /LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY INVOKER SET search_path = pg_catalog/,
  );
  assert.match(
    normalized,
    /pg_catalog\.set_config\( 'app\.user_id', p_actor_user_id, true \)/,
  );
  assert.match(
    normalized,
    /WHERE p_actor_user_id IN \( case_row\."buyerId", case_row\."sellerId" \)/,
  );
  assert.doesNotMatch(normalized, /actor\.role|EMPLOYEE|ADMIN/);
  assert.match(
    normalized,
    /"sellerRespondBy" timestamp\(3\) with time zone,[\s\S]*"resolvedAt" timestamp\(3\) with time zone,[\s\S]*"createdAt" timestamp\(3\) with time zone,[\s\S]*"updatedAt" timestamp\(3\) with time zone/,
  );
});

test("Case account export has exact runtime execution and no public execution", () => {
  assert.match(
    normalized,
    /REVOKE ALL ON FUNCTION public\.grainline_case_export_page\( text, timestamp, text, integer \) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalized,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_export_page\( text, timestamp, text, integer \) TO grainline_app_runtime/,
  );
});
