import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729052000_prepare_case_reply_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");
const body = sql.slice(
  sql.indexOf("AS $grainline_case_reply$"),
  sql.indexOf("$grainline_case_reply$;"),
);

test("Case-reply authority is compatible and does not activate Case RLS", () => {
  assert.match(sql, /Compatible fixed authority/);
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

test("Case-reply function is pinned, fixed, and runtime-executable only", () => {
  assert.match(
    normalizedSql,
    /grainline_case_reply\( p_actor_user_id text, p_case_id text, p_body text, p_direct_upload_ids text\[\] DEFAULT ARRAY\[\]::text\[\] \) RETURNS jsonb LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog/,
  );
  assert.match(
    normalizedSql,
    /REVOKE ALL ON FUNCTION public\.grainline_case_reply\(text, text, text, text\[\]\) FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    normalizedSql,
    /GRANT EXECUTE ON FUNCTION public\.grainline_case_reply\(text, text, text, text\[\]\) TO grainline_app_runtime/,
  );
  assert.doesNotMatch(body, /\bEXECUTE\b/i);
  assert.doesNotMatch(body, /\bformat\s*\(/i);
});

test("Case-reply authority locks active actor before the exact Case", () => {
  const actorLock = normalizedSql.indexOf(
    'FROM public."User" AS actor WHERE actor.id = p_actor_user_id FOR SHARE',
  );
  const caseLock = normalizedSql.indexOf(
    'FROM public."Case" AS case_row LEFT JOIN public."User" AS buyer',
  );
  assert.ok(actorLock >= 0);
  assert.ok(caseLock > actorLock);
  assert.match(
    normalizedSql,
    /WHERE case_row\.id = p_case_id FOR UPDATE OF case_row/,
  );
  assert.match(
    normalizedSql,
    /NOT actor_is_party AND locked_actor\.role IN \( 'EMPLOYEE'::public\."Role", 'ADMIN'::public\."Role" \)/,
  );
});

test("Case-reply authority derives dedup, transition, author, ids, and attachment metadata", () => {
  assert.match(
    normalizedSql,
    /normalized_upload_ids[\s\S]*array_agg\(value ORDER BY value\)/,
  );
  assert.match(
    normalizedSql,
    /duplicate_key := pg_catalog\.encode\( pg_catalog\.sha256\(/,
  );
  assert.match(
    normalizedSql,
    /pg_catalog\.pg_advisory_xact_lock\( pg_catalog\.hashtextextended\(/,
  );
  assert.match(
    normalizedSql,
    /actor_kind := CASE WHEN locked_actor\.id = locked_case\."buyerId"/,
  );
  assert.match(
    normalizedSql,
    /transition_at := pg_catalog\.timezone\( 'UTC', pg_catalog\.clock_timestamp\(\) \)/,
  );
  assert.match(
    normalizedSql,
    /target_message_id := pg_catalog\.gen_random_uuid\(\)::text/,
  );
  assert.match(normalizedSql, /INSERT INTO public\."CaseMessage"/);
  assert.match(normalizedSql, /INSERT INTO public\."CaseMessageAttachment"/);
  assert.match(
    normalizedSql,
    /"directUploadId", "objectKey", "contentType"[\s\S]*upload\.id, upload\.key, upload\."contentType"/,
  );
  assert.doesNotMatch(
    normalizedSql,
    /p_(?:recipient|author_kind|status|created_at|content_type|byte_size|attachment_id|dedup)/i,
  );
});

test("Case-reply upload authority is source-bound and lifecycle-derived", () => {
  for (const contract of [
    /upload\."userId" IS DISTINCT FROM locked_actor\.id/,
    /upload\.endpoint IS DISTINCT FROM 'caseEvidenceImage'/,
    /upload\."publicUrl" IS NOT NULL/,
    /upload\."storageClass" IS DISTINCT FROM 'PRIVATE'/,
    /upload\.status IS DISTINCT FROM 'VERIFIED'/,
    /upload\."verifiedAt" IS NULL/,
    /split_part\(upload\.key, '\/', 3\) IS DISTINCT FROM locked_case\.id/,
    /upload\."contentType" NOT IN \( 'image\/jpeg', 'image\/png', 'image\/webp' \)/,
    /upload\."expectedSize" > 8388608/,
  ]) {
    assert.match(normalizedSql, contract);
  }
  assert.match(
    normalizedSql,
    /ORDER BY row\.id FOR UPDATE/,
  );
});

test("Case-reply replay matches the exact recent body and attachment set", () => {
  assert.match(
    normalizedSql,
    /message\."createdAt" >= duplicate_cutoff/,
  );
  assert.match(
    normalizedSql,
    /array_agg\( row\."directUploadId" ORDER BY row\."directUploadId" \)/,
  );
  assert.match(normalizedSql, /\) = normalized_upload_ids/);
  assert.match(normalizedSql, /'action', 'replay'/);
  assert.match(normalizedSql, /'action', 'created'/);
});

test("PostgreSQL special forms remain unqualified", () => {
  assert.doesNotMatch(
    sql,
    /\bpg_catalog\.(?:coalesce|greatest|nullif)\s*\(/i,
  );
});
