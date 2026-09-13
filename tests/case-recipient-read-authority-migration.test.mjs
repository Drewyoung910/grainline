import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const MIGRATION_PATH =
  "prisma/migrations/20260729055000_prepare_case_recipient_read_authority/migration.sql";
const sql = fs.readFileSync(MIGRATION_PATH, "utf8");
const normalizedSql = sql.replace(/\s+/g, " ");

function functionBody(name) {
  return sql.slice(
    sql.indexOf(`AS $${name}$`),
    sql.indexOf(`$${name}$;`),
  );
}

test("Case recipient-read preparation is compatible and does not activate RLS", () => {
  assert.match(sql, /Compatible Case recipient\/staff read projections/);
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
  assert.doesNotMatch(normalizedSql, /\b(?:INSERT|UPDATE|DELETE)\b/);
});

test("Case get projections share one minimal fixed lifecycle shape", () => {
  const resultShape =
    /RETURNS TABLE \( id text, "orderId" text, "buyerId" text, "sellerId" text, reason text, description text, status text, resolution text, "refundAmountCents" integer, "sellerRespondBy" timestamp\(3\) with time zone, "escalateUnlocksAt" timestamp\(3\) with time zone, "buyerMarkedResolved" boolean, "sellerMarkedResolved" boolean, "resolvedAt" timestamp\(3\) with time zone, "createdAt" timestamp\(3\) with time zone, "actsAsStaff" boolean \)/g;
  assert.equal(normalizedSql.match(resultShape)?.length, 2);
  for (const name of [
    "grainline_case_get",
    "grainline_case_get_by_order",
  ]) {
    const body = functionBody(name);
    assert.doesNotMatch(
      body,
      /\b(?:email|clerkId|imageUrl|openedByPaymentEventId|resolvedById|stripeRefundId|updatedAt)\b/,
    );
    assert.doesNotMatch(body, /\bJOIN\b/);
    for (const field of [
      "sellerRespondBy",
      "escalateUnlocksAt",
      "resolvedAt",
      "createdAt",
    ]) {
      assert.match(
        body,
        new RegExp(`case_row\\."${field}" AT TIME ZONE 'UTC'`),
      );
    }
  }
});

test("Case reads set local actor context and enforce active participant-or-staff authority", () => {
  for (const name of [
    "grainline_case_get",
    "grainline_case_get_by_order",
  ]) {
    const body = functionBody(name);
    assert.match(
      body.replace(/\s+/g, " "),
      /pg_catalog\.set_config\( 'app\.user_id', p_actor_user_id, true \)/,
    );
    assert.match(
      body.replace(/\s+/g, " "),
      /SELECT actor\.role, actor\.banned, actor\."deletedAt" INTO actor_role, actor_banned, actor_deleted_at/,
    );
    assert.match(
      body.replace(/\s+/g, " "),
      /p_actor_user_id IN \( case_row\."buyerId", case_row\."sellerId" \) OR actor_role IN \( 'EMPLOYEE'::public\."Role", 'ADMIN'::public\."Role" \)/,
    );
    assert.match(
      body.replace(/\s+/g, " "),
      /WHEN p_actor_user_id = case_row\."buyerId" OR p_actor_user_id = case_row\."sellerId" THEN false ELSE true/,
    );
  }
});

test("staff active count returns no row for non-staff and only fixed active states", () => {
  const body = functionBody("grainline_case_staff_active_count")
    .replace(/\s+/g, " ");
  assert.match(
    body,
    /actor_role NOT IN \( 'EMPLOYEE'::public\."Role", 'ADMIN'::public\."Role" \) THEN RETURN/,
  );
  for (const status of [
    "OPEN",
    "IN_DISCUSSION",
    "PENDING_CLOSE",
    "UNDER_REVIEW",
  ]) {
    assert.match(body, new RegExp(`'${status}'::public\\."CaseStatus"`));
  }
  assert.doesNotMatch(body, /RESOLVED|CLOSED/);
});

test("all Case read projections remain one-statement INVOKER functions with exact runtime grants", () => {
  for (const [name, signature] of [
    ["grainline_case_get", "text, text"],
    ["grainline_case_get_by_order", "text, text"],
    ["grainline_case_staff_active_count", "text"],
  ]) {
    assert.match(
      normalizedSql,
      new RegExp(
        `${name}\\([\\s\\S]*?LANGUAGE plpgsql VOLATILE PARALLEL UNSAFE SECURITY INVOKER SET search_path = pg_catalog`,
      ),
    );
    assert.match(
      normalizedSql,
      new RegExp(
        `REVOKE ALL ON FUNCTION public\\.${name}\\(${signature}\\) FROM PUBLIC, grainline_app_runtime`,
      ),
    );
    assert.match(
      normalizedSql,
      new RegExp(
        `GRANT EXECUTE ON FUNCTION public\\.${name}\\(${signature}\\) TO grainline_app_runtime`,
      ),
    );
    const body = functionBody(name);
    assert.doesNotMatch(body, /\bEXECUTE\b/i);
    assert.doesNotMatch(body, /\bformat\s*\(/i);
  }
});

test("PostgreSQL special forms remain unqualified", () => {
  assert.doesNotMatch(
    sql,
    /\bpg_catalog\.(?:coalesce|greatest|least|nullif)\s*\(/i,
  );
});
