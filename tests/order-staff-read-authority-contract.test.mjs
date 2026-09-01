import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const migration = readFileSync(
  "prisma/migrations/20260901020000_prepare_order_staff_read_authority/migration.sql",
  "utf8",
);
const authority = readFileSync("src/lib/orderStaffReadAuthority.ts", "utf8");
const state = readFileSync("src/lib/orderStaffReadState.ts", "utf8");
const record = readFileSync("docs/order-staff-read-authority.md", "utf8");

describe("Order staff read authority contract", () => {
  it("keeps the two staff projections dormant to ordinary runtime", () => {
    assert.match(migration, /CREATE FUNCTION public\.grainline_order_staff_page\(/);
    assert.match(migration, /CREATE FUNCTION public\.grainline_order_staff_detail\(/);
    assert.equal((migration.match(/^SECURITY DEFINER$/gm) ?? []).length, 2);
    assert.equal((migration.match(/^SET search_path = pg_catalog$/gm) ?? []).length, 2);
    assert.equal((migration.match(/^GRANT /gm) ?? []).length, 0);
    assert.equal((migration.match(/^REVOKE ALL ON FUNCTION/gm) ?? []).length, 2);
    assert.equal((migration.match(/FROM PUBLIC, grainline_app_runtime/g) ?? []).length, 2);
    assert.doesNotMatch(migration, /ALTER TABLE|CREATE POLICY|DROP POLICY/i);
  });

  it("requires both exact session role and a live staff actor", () => {
    assert.equal(
      (migration.match(/SESSION_USER <> 'grainline_staff_read_runtime'/g) ?? []).length,
      2,
    );
    assert.equal((migration.match(/actor\.banned = false/g) ?? []).length, 2);
    assert.equal((migration.match(/actor\."deletedAt" IS NULL/g) ?? []).length, 2);
    assert.equal(
      (migration.match(/actor\.role::text IN \('EMPLOYEE', 'ADMIN'\)/g) ?? []).length,
      2,
    );
  });

  it("keeps queue provider-free and detail JSON fixed and bounded", () => {
    const pageBody = migration.slice(
      migration.indexOf("CREATE FUNCTION public.grainline_order_staff_page"),
      migration.indexOf("CREATE FUNCTION public.grainline_order_staff_detail"),
    );
    assert.doesNotMatch(pageBody, /stripe|shippo|sellerRefundId|refundClaimId|labelClawback/i);
    assert.match(pageBody, /p_scope NOT IN \('ALL', 'REVIEW_NEEDED'\)/);
    assert.match(pageBody, /p_page_size NOT BETWEEN 1 AND 50/);
    assert.match(migration, /item_count > 100/);
    assert.match(migration, /'currentListingType'/);
    assert.doesNotMatch(migration, /unexpectedSecret/);
  });

  it("requires an explicit dedicated client and validates every result", () => {
    assert.match(authority, /client: StaffOrderReadClient/g);
    assert.doesNotMatch(authority, /client: StaffOrderReadClient = prisma/);
    assert.doesNotMatch(authority, /from "@\/lib\/db"/);
    assert.match(authority, /grainline_order_staff_page/);
    assert.match(authority, /grainline_order_staff_detail/);
    assert.match(state, /purged buyer data is inconsistent/);
    assert.match(state, /refund identity is inconsistent/);
  });

  it("records the separate-role and no-production boundaries", () => {
    assert.match(record, /separate later release/);
    assert.match(record, /revokes `PUBLIC` and ordinary\s+runtime execution/);
    assert.match(record, /has not been merged,\s+applied/);
    assert.match(record, /`Order` RLS remains off/);
    assert.match(record, /does not authorize a role, credential, migration run/);
  });
});
