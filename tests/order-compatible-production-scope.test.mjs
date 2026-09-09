import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ORDER_COMPATIBLE_PRODUCTION_CHARGED_TOTAL_PREFIX_LENGTH,
  ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS,
} from "../scripts/order-compatible-production-catalog.mjs";
import {
  assertOrderCompatibleProductionLedger,
  assertOrderCompatibleProductionScope,
  ORDER_COMPATIBLE_REVIEWED_SUCCESSORS,
  parseOrderCompatibleProductionScopeEnvironment,
  verifyOrderCompatibleProductionScope,
} from "../scripts/verify-order-compatible-production-scope.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function applied(migration) {
  return {
    migration_name: migration.name,
    checksum: migration.checksum,
    finished_at: "2026-09-01T00:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function snapshot(prefixLength) {
  return {
    ledgerRows: ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS
      .slice(0, prefixLength)
      .map(applied),
    orderTable: {
      owner_name: "neondb_owner",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_can_select: true,
      runtime_can_insert: true,
      runtime_can_update: true,
      runtime_can_delete: true,
      public_has_crud: false,
    },
    chargedTotalColumns:
      prefixLength >= ORDER_COMPATIBLE_PRODUCTION_CHARGED_TOTAL_PREFIX_LENGTH
      ? [{
          column_name: "chargedTotalCents",
          data_type: "integer",
          is_nullable: "YES",
          column_default: null,
        }]
      : [],
  };
}

test("catalog is ordered, unique, and byte-pinned", () => {
  const names = ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.map(({ name }) => name);
  assert.deepEqual(names, [...names].sort());
  assert.equal(new Set(names).size, names.length);
  assert.equal(names.length, 18);
  assert.equal(ORDER_COMPATIBLE_PRODUCTION_CHARGED_TOTAL_PREFIX_LENGTH, 17);
  assert.equal(ORDER_COMPATIBLE_REVIEWED_SUCCESSORS.length, 17);
  assert.deepEqual(
    ORDER_COMPATIBLE_REVIEWED_SUCCESSORS.map(({ name }) => name),
    [...ORDER_COMPATIBLE_REVIEWED_SUCCESSORS.map(({ name }) => name)].sort(),
  );
  for (const migration of ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS) {
    const sql = readFileSync(
      `prisma/migrations/${migration.name}/migration.sql`,
      "utf8",
    );
    assert.equal(
      createHash("sha256").update(sql).digest("hex"),
      migration.checksum,
    );
  }
});

test("scope SQL checks PUBLIC ACLs through the zero grantee", () => {
  const source = readFileSync(
    "scripts/verify-order-compatible-production-scope.mjs",
    "utf8",
  );
  assert.match(source, /pg_catalog\.aclexplode/u);
  assert.match(source, /acl\.grantee = 0/u);
  assert.doesNotMatch(source, /has_table_privilege\('PUBLIC'/u);
});

test("environment parser accepts only manual main and the direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    ORDER_COMPATIBLE_PRODUCTION_SCOPE_STAGE: "restart",
  };
  assert.equal(
    parseOrderCompatibleProductionScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { ORDER_COMPATIBLE_PRODUCTION_SCOPE_STAGE: "before" },
  ]) {
    assert.throws(() =>
      parseOrderCompatibleProductionScopeEnvironment({ ...env, ...drift })
    );
  }
});

test("ledger accepts every exact prefix and rejects drift", () => {
  for (
    let prefix = 0;
    prefix <= ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.length;
    prefix += 1
  ) {
    assert.equal(
      assertOrderCompatibleProductionLedger(
        ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.slice(0, prefix).map(applied),
        "restart",
      ),
      prefix,
    );
  }
  assert.equal(
    assertOrderCompatibleProductionLedger(
      [
        ...ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS,
        ...ORDER_COMPATIBLE_REVIEWED_SUCCESSORS,
      ].map(applied),
      "after",
    ),
    18,
  );
  for (
    let prefix = 0;
    prefix <= ORDER_COMPATIBLE_REVIEWED_SUCCESSORS.length;
    prefix += 1
  ) {
    assert.equal(
      assertOrderCompatibleProductionLedger([
        ...ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.map(applied),
        ...ORDER_COMPATIBLE_REVIEWED_SUCCESSORS.slice(0, prefix).map(applied),
      ], "after"),
      18,
    );
  }
  const gap = [
    applied(ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS[0]),
    applied(ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS[2]),
  ];
  assert.throws(() => assertOrderCompatibleProductionLedger(gap, "restart"));
  const wrong = applied(ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS[0]);
  wrong.checksum = "0".repeat(64);
  assert.throws(() =>
    assertOrderCompatibleProductionLedger([wrong], "restart")
  );
  assert.throws(() =>
    assertOrderCompatibleProductionLedger([
      applied(ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS[0]),
      applied(ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS[0]),
    ], "restart")
  );
  assert.throws(() =>
    assertOrderCompatibleProductionLedger([{
      ...applied(ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS[0]),
      migration_name: "20260901160000_correct_case_order_invariants",
    }], "restart")
  );
  assert.throws(() => assertOrderCompatibleProductionLedger([], "after"));
  assert.throws(() =>
    assertOrderCompatibleProductionLedger([
      ...ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.map(applied),
      applied(ORDER_COMPATIBLE_REVIEWED_SUCCESSORS[1]),
    ], "after")
  );
  const driftedSuccessor = applied(ORDER_COMPATIBLE_REVIEWED_SUCCESSORS[0]);
  driftedSuccessor.checksum = "f".repeat(64);
  assert.throws(() =>
    assertOrderCompatibleProductionLedger([
      ...ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.map(applied),
      driftedSuccessor,
    ], "after")
  );
  assert.throws(() =>
    assertOrderCompatibleProductionLedger([
      applied(ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS[0]),
      applied(ORDER_COMPATIBLE_REVIEWED_SUCCESSORS[0]),
    ], "restart")
  );
});

test("scope accepts restart prefixes and exact final posture", async () => {
  for (
    let prefix = 0;
    prefix <= ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.length;
    prefix += 1
  ) {
    const result = assertOrderCompatibleProductionScope(
      snapshot(prefix),
      "restart",
    );
    assert.equal(result.migrationPrefixLength, prefix);
    assert.equal(result.orderRlsEnabled, false);
    assert.equal(result.predecessorRuntimeCrudRetained, true);
  }
  const final = assertOrderCompatibleProductionScope(snapshot(18), "after");
  assert.equal(final.state, "order-compatible");
  const verified = await verifyOrderCompatibleProductionScope(
    { directUrl: URL, stage: "after" },
    { readSnapshot: async () => snapshot(18) },
  );
  assert.equal(verified.migrationCount, 18);
});

test("scope rejects Order posture and charged-column drift", () => {
  const cases = [];
  const add = (mutate) => {
    const value = snapshot(18);
    mutate(value);
    cases.push(value);
  };
  add((value) => { value.orderTable.rls_enabled = true; });
  add((value) => { value.orderTable.runtime_can_delete = false; });
  add((value) => { value.orderTable.public_has_crud = true; });
  add((value) => { value.chargedTotalColumns[0].data_type = "bigint"; });
  add((value) => { value.chargedTotalColumns[0].is_nullable = "NO"; });
  add((value) => { value.chargedTotalColumns[0].column_default = "0"; });
  for (const value of cases) {
    assert.throws(() => assertOrderCompatibleProductionScope(value, "after"));
  }
  const earlyColumn = snapshot(16);
  earlyColumn.chargedTotalColumns = snapshot(17).chargedTotalColumns;
  assert.throws(() =>
    assertOrderCompatibleProductionScope(earlyColumn, "restart")
  );
});
