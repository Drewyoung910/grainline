import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS,
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS,
  CHECKOUT_STOCK_RESERVATION_RETIRED_CREATION_FUNCTION_NAMES,
} from "../scripts/checkout-stock-reservation-authority-catalog.mjs";
import {
  checkoutStockReservationSourceConsistentFunctionSourceMd5,
  checkoutStockReservationSourceConsistentFunctionSourceSha256,
} from "../scripts/checkout-stock-reservation-function-source-catalog.mjs";

const activation = fs.readFileSync(
  "docs/rls-drafts/checkout-stock-reservation-activation.sql",
  "utf8",
);
const rollback = fs.readFileSync(
  "docs/rls-drafts/checkout-stock-reservation-activation-rollback.sql",
  "utf8",
);
const provisioning = fs.readFileSync(
  "scripts/provision-runtime-db-role.sql",
  "utf8",
);

test("activation is one policyless ENABLE boundary with bounded locks", () => {
  assert.equal((activation.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((activation.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.match(activation, /SET LOCAL lock_timeout = '10s'/);
  assert.match(activation, /SET LOCAL statement_timeout = '120s'/);
  assert.match(activation, /pg_catalog\.hashtextextended/);
  assert.match(
    activation,
    /LOCK TABLE public\."CheckoutStockReservation" IN ACCESS EXCLUSIVE MODE/,
  );
  assert.match(
    activation,
    /ALTER TABLE public\."CheckoutStockReservation" ENABLE ROW LEVEL SECURITY/,
  );
  assert.doesNotMatch(activation, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(activation, /CREATE POLICY|ALTER POLICY/);
  assert.match(
    activation,
    /REVOKE ALL ON TABLE public\."CheckoutStockReservation"\s+FROM PUBLIC, grainline_app_runtime/,
  );
  assert.match(
    activation,
    /REVOKE EXECUTE ON FUNCTION[\s\S]*grainline_checkout_reservation_create_cart[\s\S]*grainline_checkout_reservation_create_single[\s\S]*FROM PUBLIC, grainline_app_runtime/,
  );
});

test("activation re-attests exact role, catalog, data and ACL predecessors", () => {
  for (const pattern of [
    /runtime_role\.rolinherit/,
    /WITH RECURSIVE restricted_members/,
    /member\.rolname = 'neondb_owner'/,
    /grantor\.rolname = 'cloud_admin'/,
    /owner-session drain is incomplete/,
    /service-only activation requires zero policies/,
    /actual_constraint_count <> 5 OR accepted_constraint_count <> 5/,
    /pg_catalog\.pg_get_constraintdef\(constraint_row\.oid\)/,
    /actual_index_count <> 9 OR accepted_index_count <> 9/,
    /pg_catalog\.pg_get_expr\(index_row\.indpred, index_row\.indrelid\)/,
    /FROM unnest\(index_row\.indkey\) WITH ORDINALITY/,
    /actual_trigger_count <> 1 OR normalize_trigger_count <> 1/,
    /grainline_checkout_reservation_items_valid/,
    /actual_function_count <> 25/,
    /accepted_function_count <> 25/,
    /oidvectortypes\(procedure\.proargtypes\)/,
    /procedure\.proconfig = ARRAY\['search_path=pg_catalog'\]::text\[\]/,
  ]) {
    assert.match(activation, pattern);
  }
  assert.doesNotMatch(
    activation,
    /(?:INSERT INTO|UPDATE|DELETE FROM) public\."CheckoutStockReservation"/,
  );
  assert.doesNotMatch(activation, /has_any_column_privilege/);
  assert.doesNotMatch(
    activation,
    /has_function_privilege\(\s*'PUBLIC'/,
  );
  assert.match(activation, /acl\.grantee IN \(0, runtime_role_oid\)/);
});

test("activation pins every fixed function to its promoted source", () => {
  const md5 = checkoutStockReservationSourceConsistentFunctionSourceMd5();
  const sha256 = checkoutStockReservationSourceConsistentFunctionSourceSha256();
  assert.equal(Object.keys(md5).length, 25);
  assert.equal(Object.keys(sha256).length, 25);
  assert.equal(CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.length, 25);

  for (const entry of CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS) {
    const signature = `${entry.name}(${entry.argumentTypes})`;
    assert.match(md5[signature], /^[0-9a-f]{32}$/);
    assert.match(sha256[signature], /^[0-9a-f]{64}$/);
    const expectedRow = `('${entry.name}', '${entry.argumentTypes}', '${md5[signature]}', ${entry.runtimeExecute}, '${entry.volatility}', '${entry.parallelSafety}')`;
    assert.ok(
      activation.includes(expectedRow),
      `activation source catalog is missing ${signature}`,
    );
  }
});

test("activation retires legacy creation execution without dropping rollback functions", () => {
  assert.equal(
    CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS.filter(
      (entry) => entry.runtimeExecute,
    ).length,
    16,
  );
  assert.equal(
    CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS.filter(
      (entry) => !entry.runtimeExecute,
    ).length,
    9,
  );
  assert.deepEqual(
    CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS
      .filter((entry) => (
        CHECKOUT_STOCK_RESERVATION_RETIRED_CREATION_FUNCTION_NAMES.includes(
          entry.name,
        )
      ))
      .map((entry) => entry.runtimeExecute),
    [false, false],
  );
  assert.doesNotMatch(activation, /DROP FUNCTION/);
  assert.match(activation, /retired_creation_count <> 2/);
});

test("rollback is database-first and restores only compatible CRUD", () => {
  assert.equal((rollback.match(/^BEGIN;$/gm) ?? []).length, 1);
  assert.equal((rollback.match(/^COMMIT;$/gm) ?? []).length, 1);
  assert.match(rollback, /activation rollback predecessor drifted/);
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/);
  assert.match(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.match(
    rollback,
    /GRANT SELECT, INSERT, UPDATE, DELETE\s+ON TABLE public\."CheckoutStockReservation"\s+TO grainline_app_runtime/,
  );
  assert.doesNotMatch(rollback, /CREATE POLICY|DROP FUNCTION|DROP TABLE/);
  assert.doesNotMatch(rollback, /has_any_column_privilege/);
  assert.match(
    rollback,
    /rollback requires retired legacy creation authority/,
  );
  assert.match(
    rollback,
    /rollback restored retired creation authority/,
  );
});

test("runtime provisioning converges clean predecessor and activated states", () => {
  assert.match(
    provisioning,
    /CheckoutStockReservation RLS is partially or unexpectedly configured; refusing runtime-role provisioning/,
  );
  assert.match(
    provisioning,
    /NOT relrowsecurity\s+AND NOT relforcerowsecurity\s+AND policy_count = 0/,
  );
  assert.match(
    provisioning,
    /relrowsecurity AND policy_count = 0/,
  );
  assert.match(
    provisioning,
    /\\if :checkout_stock_reservation_rls_active[\s\S]*REVOKE ALL ON TABLE public\."CheckoutStockReservation"\s+FROM PUBLIC, :"runtime_role"/,
  );
});
