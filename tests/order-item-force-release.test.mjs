import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  ORDER_ITEM_FORCE_RELEASE,
  buildOrderItemForceCandidate,
} from "../scripts/build-order-item-force-candidate.mjs";

test("OrderItem FORCE is one pinned policyless posture release", () => {
  const release = buildOrderItemForceCandidate();
  assert.equal(release.migrationName, "20261001040000_force_order_item_rls");
  assert.equal(release.migrationSha256, ORDER_ITEM_FORCE_RELEASE.migrationSha256);
  assert.match(release.migration, /OrderItem FORCE/);
  assert.match(release.migration, /OrderItem" FORCE ROW LEVEL SECURITY/);
  assert.match(release.migration, /accepted_functions <> 34/);
  assert.match(release.migration, /accepted_triggers <> 2/);
  assert.match(release.migration, /pg_catalog\.pg_auth_members/);
  assert.match(release.migration, /OrderItem owner-session drain is incomplete/);
  assert.match(release.migration, /OrderShippingRateQuote stays/);
  assert.doesNotMatch(release.migration, /CREATE POLICY|DROP POLICY/);
  assert.doesNotMatch(
    release.migration,
    /OrderItem" (?:ENABLE|NO FORCE) ROW LEVEL SECURITY/,
  );
  assert.equal(
    release.migration,
    fs.readFileSync(path.resolve(ORDER_ITEM_FORCE_RELEASE.migrationPath), "utf8"),
  );
});

test("OrderItem rollback restores policyless zero-direct ENABLE", () => {
  const { rollback } = buildOrderItemForceCandidate();
  assert.match(rollback, /NO FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(rollback, /DISABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(rollback, /\bGRANT\b/);
  assert.match(rollback, /remains policyless ENABLE/);
  assert.match(rollback, /pg_catalog\.pg_auth_members/);
  assert.match(rollback, /OrderItem rollback owner-session drain is incomplete/);
});
