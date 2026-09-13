import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729058000_prepare_case_seller_aggregate_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

function functionBody(name) {
  const marker = `$${name}$`;
  const start = sql.indexOf(`AS ${marker}`);
  const end = sql.indexOf(`${marker};`, start);
  assert.ok(start >= 0 && end > start, `${name} body is missing`);
  return sql.slice(start, end).replace(/\s+/g, " ");
}

const activeCountBody = functionBody("grainline_case_seller_active_count");
const verificationBody = functionBody(
  "grainline_case_seller_verification_eligibility",
);
const guildBody = functionBody("grainline_case_guild_unresolved_guard");

test("seller aggregate preparation remains compatible and does not activate RLS", () => {
  assert.match(sql, /Compatible purpose-bound Case aggregates/);
  assert.doesNotMatch(
    normalizedSql,
    /ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" (?:ENABLE|FORCE) ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(normalizedSql, /CREATE POLICY/);
  assert.doesNotMatch(
    normalizedSql,
    /(?:GRANT|REVOKE).* ON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"/,
  );
  assert.doesNotMatch(normalizedSql, /DROP (?:TABLE|COLUMN|FUNCTION)/);
});

test("all three operations are pinned SECURITY DEFINER functions", () => {
  for (const signature of [
    "grainline_case_seller_active_count\\( p_seller_profile_id text \\)",
    "grainline_case_seller_verification_eligibility\\( p_actor_user_id text, p_seller_profile_id text \\)",
    "grainline_case_guild_unresolved_guard\\( p_seller_profile_id text \\)",
  ]) {
    assert.match(
      normalizedSql,
      new RegExp(
        `${signature} RETURNS TABLE \\([^)]+\\) LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY DEFINER SET search_path = pg_catalog`,
      ),
    );
  }
  for (const body of [activeCountBody, verificationBody, guildBody]) {
    assert.doesNotMatch(body, /\bEXECUTE\b/i);
    assert.doesNotMatch(body, /\bformat\s*\(/i);
    assert.doesNotMatch(
      body,
      /\b(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM)\b/i,
    );
    for (const status of [
      "OPEN",
      "IN_DISCUSSION",
      "PENDING_CLOSE",
      "UNDER_REVIEW",
    ]) {
      assert.match(body, new RegExp(`'${status}'::public\\."CaseStatus"`));
    }
  }
});

test("seller metrics receives only one exact active Case count", () => {
  assert.match(
    activeCountBody,
    /seller\.id = p_seller_profile_id/,
  );
  assert.match(activeCountBody, /seller_user\.banned = false/);
  assert.match(activeCountBody, /seller_user\."deletedAt" IS NULL/);
  assert.match(
    activeCountBody,
    /case_row\."sellerId" = target_seller_user_id/,
  );
  assert.match(activeCountBody, /pg_catalog\.count\(\*\)::bigint/);
  assert.doesNotMatch(activeCountBody, /"CaseMessage"|description|reason/);
});

test("verification derives the actor relationship and fixed 60-day cutoff", () => {
  assert.match(
    verificationBody,
    /actor\.id = seller\."userId" OR actor\.role IN \( 'EMPLOYEE'::public\."Role", 'ADMIN'::public\."Role" \)/,
  );
  assert.match(verificationBody, /actor\.banned = false/);
  assert.match(verificationBody, /actor\."deletedAt" IS NULL/);
  assert.match(
    verificationBody,
    /fixed_cutoff := \(pg_catalog\.clock_timestamp\(\) AT TIME ZONE 'UTC'\) - INTERVAL '60 days'/,
  );
  assert.match(verificationBody, /case_row\."createdAt" < fixed_cutoff/);
  assert.doesNotMatch(verificationBody, /\bp_(?:cutoff|created_before)\b/);
});

test("Guild guard derives the fixed threshold, state, and locks the blocking Case", () => {
  assert.match(
    guildBody,
    /seller\."guildLevel" = 'GUILD_MEMBER'::public\."GuildLevel"/,
  );
  assert.match(
    guildBody,
    /seller\."guildLevel" = 'NONE'::public\."GuildLevel" AND seller\."guildMemberApprovedAt" IS NOT NULL/,
  );
  assert.match(
    guildBody,
    /fixed_cutoff := \(pg_catalog\.clock_timestamp\(\) AT TIME ZONE 'UTC'\) - INTERVAL '90 days'/,
  );
  assert.match(
    guildBody,
    /ORDER BY case_row\."createdAt" ASC, case_row\.id ASC FOR UPDATE OF case_row LIMIT 1/,
  );
  assert.match(guildBody, /\(blocking_case_id IS NOT NULL\)::boolean/);
  assert.doesNotMatch(guildBody, /\bp_(?:cutoff|created_before)\b/);
});

test("all three operations have exact runtime grants and no public execution", () => {
  for (const signature of [
    "grainline_case_seller_active_count\\(text\\)",
    "grainline_case_seller_verification_eligibility\\(text, text\\)",
    "grainline_case_guild_unresolved_guard\\(text\\)",
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
