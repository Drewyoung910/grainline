import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const path =
  "prisma/migrations/20260815210000_prepare_seller_payout_event_authority/migration.sql";
const sql = readFileSync(path, "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

test("prepares event ordering without activating SellerPayoutEvent RLS", () => {
  assert.match(schema, /stripeEventCreatedSeconds\s+BigInt\?/);
  assert.match(schema, /stripeEventId\s+String\?\s+@unique/);
  assert.match(
    schema,
    /@@index\(\[sellerProfileId, stripeEventCreatedSeconds\(sort: Desc\), id\(sort: Desc\)\]/,
  );
  assert.match(sql, /ADD COLUMN "stripeEventCreatedSeconds" bigint/);
  assert.match(sql, /SellerPayoutEvent_seller_event_time_idx/);
  assert.doesNotMatch(sql, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(sql, /REVOKE ALL ON (?:TABLE|ALL TABLES)/);
});

test("binds writes to the exact active payout source and derives the target", () => {
  assert.match(sql, /grainline_seller_payout_event_apply/);
  assert.match(sql, /source_event\.type IS DISTINCT FROM 'payout\.failed'/);
  assert.match(sql, /source_event\."sourceObjectId" IS DISTINCT FROM p_payout_id/);
  assert.match(sql, /source_event\."claimGeneration" IS DISTINCT FROM p_claim_generation/);
  assert.match(sql, /source_event\."processedAt" IS NOT NULL/);
  assert.match(sql, /seller\."stripeAccountId" = p_connected_account_id/);
  assert.doesNotMatch(sql, /p_seller(?:_profile)?_id/);
  assert.doesNotMatch(sql, /p_payout_event_id/);
  assert.doesNotMatch(sql, /p_status/);
});

test("makes payout mutation ordered and exact-replay idempotent", () => {
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock\(/);
  assert.match(sql, /pg_catalog\.hashtextextended\(p_payout_id, 620081501\)/);
  assert.match(sql, /source_payout\."stripeEventId" = p_event_id/);
  assert.match(sql, /'already_applied'/);
  assert.match(sql, /'legacy_converged'/);
  assert.match(sql, /p_event_created_seconds < source_payout\."stripeEventCreatedSeconds"/);
  assert.match(sql, /'stale_ignored'/);
  assert.match(sql, /p_event_created_seconds = source_payout\."stripeEventCreatedSeconds"/);
  assert.match(sql, /ordering is ambiguous/);
  assert.match(sql, /Seller payout replay payload is inconsistent/);
});

test("installs bounded seller-only latest and export projections", () => {
  assert.match(sql, /grainline_seller_payout_latest_failure/);
  assert.match(sql, /grainline_seller_payout_export_page/);
  assert.match(sql, /seller\."userId" = p_actor_user_id/g);
  assert.match(sql, /LEAST\(GREATEST\(p_limit, 1\), 500\)/);
  assert.match(sql, /\) < \(p_before_event_created_seconds, p_before_id\)/);
  assert.match(sql, /AT TIME ZONE 'UTC'/);
});

test("keeps all new functions pinned and PUBLIC-revoked", () => {
  const functionNames = [
    "grainline_seller_payout_event_apply",
    "grainline_seller_payout_latest_failure",
    "grainline_seller_payout_export_page",
  ];
  for (const name of functionNames) {
    const start = sql.indexOf(`CREATE FUNCTION public.${name}`);
    assert.ok(start >= 0, name);
    const body = sql.slice(start, sql.indexOf(";", sql.indexOf(`$${name}$`, start) + name.length + 3) + 1);
    assert.match(body, /SECURITY DEFINER/);
    assert.match(body, /SET search_path = pg_catalog/);
    assert.match(sql, new RegExp(`REVOKE ALL ON FUNCTION public\\.${name}\\([\\s\\S]*?FROM PUBLIC, grainline_app_runtime`));
    assert.match(sql, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\([\\s\\S]*?TO grainline_app_runtime`));
  }
  assert.doesNotMatch(sql, /\bEXECUTE\s+[^\n]*\bformat\s*\(/i);
  assert.doesNotMatch(sql, /pg_catalog\.(?:greatest|least|nullif|coalesce)\b/i);
});
