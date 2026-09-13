import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729054000_prepare_case_message_page_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");
const body = sql.slice(
  sql.indexOf("AS $grainline_case_message_page$"),
  sql.indexOf("$grainline_case_message_page$;"),
);

test("Case-message page is compatible and does not activate Case RLS", () => {
  assert.match(sql, /Compatible, bounded Case-message history projection/);
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

test("Case-message page is a pinned, source-validating DEFINER projection", () => {
  assert.match(
    normalizedSql,
    /grainline_case_message_page\( p_actor_user_id text, p_case_id text, p_cursor_created_at timestamp\(3\), p_cursor_id text, p_limit integer \) RETURNS TABLE \( id text, "authorId" text, "authorKind" text, body text, "createdAt" timestamp\(3\), attachments jsonb \) LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON FUNCTION public\.grainline_case_message_page\( text, text, timestamp, text, integer \) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_message_page\( text, text, timestamp, text, integer \) TO grainline_app_runtime/,
  );
  assert.doesNotMatch(body, /\bEXECUTE\b/i);
  assert.doesNotMatch(body, /\bformat\s*\(/i);
});

test("Case-message page fixes actor, source, cursor, and page bounds", () => {
  assert.match(
    normalizedSql,
    /p_actor_user_id !~ '\^\[A-Za-z0-9\._:-\]\{1,128\}\$'/,
  );
  assert.match(
    normalizedSql,
    /\(p_cursor_created_at IS NULL\) <> \(p_cursor_id IS NULL\)/,
  );
  assert.match(normalizedSql, /p_limit < 1 OR p_limit > 51/);
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
    /ORDER BY message\."createdAt" DESC, message\.id DESC LIMIT p_limit/,
  );
  assert.match(
    normalizedSql,
    /message\."createdAt" < p_cursor_created_at OR \( message\."createdAt" = p_cursor_created_at AND message\.id < p_cursor_id \)/,
  );
});

test("Case-message page derives minimal output without private object or User profile data", () => {
  assert.match(
    normalizedSql,
    /WHEN page\."authorKind" IS NOT NULL THEN page\."authorKind"::text WHEN page\."authorId" = page\."buyerId" THEN 'BUYER'::text WHEN page\."authorId" = page\."sellerId" THEN 'SELLER'::text ELSE NULL::text/,
  );
  for (const key of ["id", "contentType", "byteSize", "createdAt"]) {
    assert.match(normalizedSql, new RegExp(`'${key}'`));
  }
  assert.match(
    normalizedSql,
    /FROM public\."CaseMessageAttachment" AS candidate WHERE candidate\."caseMessageId" = page\.id ORDER BY candidate\."createdAt", candidate\.id LIMIT 4/,
  );
  assert.doesNotMatch(
    body,
    /\b(?:email|clerkId|imageUrl|objectKey|directUploadId|publicUrl)\b/,
  );
  assert.doesNotMatch(body, /JOIN public\."User" AS author/);
});

test("PostgreSQL special forms remain unqualified", () => {
  assert.doesNotMatch(
    sql,
    /\bpg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
  );
});
