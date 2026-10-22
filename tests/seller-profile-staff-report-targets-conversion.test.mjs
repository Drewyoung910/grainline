import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261020130000_prepare_seller_profile_staff_report_targets/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerProfileStaffAccess.ts", "utf8");
const page = readFileSync("src/app/admin/reports/page.tsx", "utf8");
const reviewQueue = readFileSync("src/app/admin/review/page.tsx", "utf8");

test("seller report targets require the isolated active-staff authority", () => {
  assert.match(migration, /SESSION_USER <> 'grainline_staff_read_runtime'/u);
  assert.match(migration, /actor\.role::text IN \('ADMIN', 'EMPLOYEE'\)/u);
  assert.match(migration, /actor\.banned = false/u);
  assert.match(migration, /actor\."deletedAt" IS NULL/u);
  assert.match(migration, /cardinality\(p_seller_profile_ids\) > 50/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_staff_read_runtime/u);
});

test("admin reports use the bounded staff projection after the PIN gate", () => {
  assert.match(page, /requireAdminPageAccess\(\)/u);
  assert.match(page, /sellerProfileStaffReportTargets\(getOrderStaffReadClient\(\), \{/u);
  assert.match(page, /actorId: staff\.id/u);
  assert.doesNotMatch(page, /prisma\.sellerProfile\./u);
  assert.match(access, /grainline_seller_staff_report_targets/u);
  assert.match(access, /sellerProfileIds\.length > 50/u);
});

test("admin listing review resolves seller labels through the bounded staff projection", () => {
  assert.match(reviewQueue, /requireAdminPageAccess\(\)/u);
  assert.match(reviewQueue, /const SELLER_TARGET_CHUNK_SIZE = 50/u);
  assert.match(
    reviewQueue,
    /sellerProfileStaffReportTargets\(getOrderStaffReadClient\(\), \{/u,
  );
  assert.match(reviewQueue, /actorId: staff\.id/u);
  assert.match(reviewQueue, /prisma\.listing\.groupBy\(/u);
  assert.doesNotMatch(reviewQueue, /seller:\s*\{\s*select:/u);
});
