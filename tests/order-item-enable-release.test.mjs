import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ORDER_ITEM_ENABLE_RELEASE,
  buildOrderItemRlsCandidate,
} from "../scripts/build-order-item-rls-candidate.mjs";

test("OrderItem ENABLE is one pinned policyless table release", () => {
  const release = buildOrderItemRlsCandidate();
  assert.equal(release.migrationName, "20261001030000_enable_order_item_rls");
  assert.equal(release.migrationSha256, ORDER_ITEM_ENABLE_RELEASE.migrationSha256);
  assert.match(release.migration, /OrderItem ENABLE/);
  assert.match(release.migration, /accepted_functions <> 34/);
  assert.match(release.migration, /accepted_triggers <> 2/);
  assert.match(release.migration, /OrderShippingRateQuote stays/);
  assert.doesNotMatch(release.migration, /CREATE POLICY|DROP POLICY/);
  assert.equal(
    release.migration,
    fs.readFileSync(path.resolve(ORDER_ITEM_ENABLE_RELEASE.migrationPath), "utf8"),
  );
});

test("OrderItem rollback restores the zero-direct RLS-off predecessor", () => {
  const { rollback } = buildOrderItemRlsCandidate();
  assert.match(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(rollback, /\bGRANT\b/);
  assert.match(rollback, /zero ordinary-runtime, staff-runtime and PUBLIC table authority/);
});
