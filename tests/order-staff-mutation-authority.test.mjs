import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

const sql = fs.readFileSync(
  "docs/rls-drafts/order-staff-mutation-authority.sql",
  "utf8",
);
const authority = fs.readFileSync("src/lib/orderStaffMutationAuthority.ts", "utf8");
const actions = fs.readFileSync("src/app/admin/actions.ts", "utf8");

describe("Order staff mutation authority", () => {
  it("creates three exact actor-bound operations with atomic audits", () => {
    assert.equal((sql.match(/CREATE OR REPLACE FUNCTION/gu) ?? []).length, 3);
    assert.equal((sql.match(/SECURITY DEFINER/gu) ?? []).length, 3);
    assert.equal((sql.match(/SET search_path = pg_catalog/gu) ?? []).length, 3);
    assert.equal((sql.match(/INSERT INTO public\."AdminAuditLog"/gu) ?? []).length, 3);
    assert.equal((sql.match(/FOR UPDATE/gu) ?? []).length, 3);
    assert.equal((sql.match(/FOR SHARE/gu) ?? []).length, 3);
    assert.match(sql, /actor\.role::text IN \('EMPLOYEE', 'ADMIN'\)/);
    assert.match(sql, /actor\.banned = false/);
    assert.match(sql, /actor\."deletedAt" IS NULL/);
  });

  it("keeps label and note decisions database-derived and bounded", () => {
    assert.match(sql, /"labelStatus" IS DISTINCT FROM 'PURCHASED'/);
    assert.match(sql, /"labelClawbackStatus" IN \('RETRY_PENDING', 'RETRYING'\)/);
    assert.match(sql, /"labelStatus" = 'VOIDED'/);
    assert.match(sql, /pg_catalog\.clock_timestamp\(\) AT TIME ZONE 'UTC'/);
    assert.match(sql, /pg_catalog\.char_length\(normalized_note\) NOT BETWEEN 1 AND 2000/);
    assert.equal((sql.match(/pg_catalog\.char_length\(next_note\) > 10000/gu) ?? []).length, 2);
    assert.doesNotMatch(sql, /p_timestamp|p_action|p_metadata/);
  });

  it("keeps runtime on fixed functions and the app off direct Order access", () => {
    assert.equal((sql.match(/GRANT EXECUTE ON FUNCTION/gu) ?? []).length, 3);
    assert.equal((sql.match(/REVOKE ALL ON FUNCTION/gu) ?? []).length, 3);
    assert.doesNotMatch(sql, /GRANT\s+(?:SELECT|INSERT|UPDATE|DELETE)|CREATE POLICY|ENABLE ROW LEVEL SECURITY/);
    assert.match(authority, /markStaffOrderReviewed/);
    assert.match(authority, /recordStaffOrderLabelVoided/);
    assert.match(authority, /appendStaffOrderNote/);
    assert.match(actions, /markStaffOrderReviewed\(admin\.id, orderId\)/);
    assert.match(actions, /recordStaffOrderLabelVoided\(admin\.id, orderId\)/);
    assert.match(actions, /appendStaffOrderNote\(admin\.id, orderId, note\)/);
    assert.doesNotMatch(actions, /(?:prisma|tx)\.order\./);
    assert.doesNotMatch(actions, /logAdminActionOrThrow/);
  });
});
