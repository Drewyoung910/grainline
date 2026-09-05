import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  CASE_CORRECTNESS_MIGRATION,
  CASE_CORRECTNESS_MIGRATION_SHA256,
} from "../scripts/build-case-correctness-migration.mjs";
import {
  ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS,
} from "../scripts/order-compatible-production-catalog.mjs";
import {
  assertCaseCorrectnessLedger,
  assertCaseCorrectnessProductionScope,
  parseCaseCorrectnessProductionScopeEnvironment,
  verifyCaseCorrectnessProductionScope,
} from "../scripts/verify-case-correctness-production-scope.mjs";
import {
  ORDER_COMPATIBLE_REVIEWED_SUCCESSORS,
} from "../scripts/verify-order-compatible-production-scope.mjs";

const URL = "postgresql://neondb_owner:owner@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

test("scope SQL checks PUBLIC ACLs through the zero grantee", () => {
  const source = readFileSync(
    "scripts/verify-case-correctness-production-scope.mjs",
    "utf8",
  );
  assert.match(source, /pg_catalog\.aclexplode/u);
  assert.match(source, /acl\.grantee = 0/u);
  assert.doesNotMatch(source, /has_table_privilege\('PUBLIC'/u);
});

function applied(migration) {
  return {
    migration_name: migration.name,
    checksum: migration.checksum,
    finished_at: "2026-09-01T00:00:00.000Z",
    rolled_back_at: null,
    applied_steps_count: 1,
  };
}

function caseRow() {
  return applied({
    name: CASE_CORRECTNESS_MIGRATION,
    checksum: CASE_CORRECTNESS_MIGRATION_SHA256,
  });
}

function snapshot(caseApplied, successorPrefixLength = caseApplied ? 1 : 0) {
  return {
    orderLedgerRows: [
      ...ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.map(applied),
      ...ORDER_COMPATIBLE_REVIEWED_SUCCESSORS
        .slice(0, successorPrefixLength)
        .map(applied),
    ],
    caseLedgerRows: caseApplied ? [caseRow()] : [],
    unexpectedLedgerRows: [],
    caseTables: ["Case", "CaseMessage", "CaseMessageAttachment"].map(
      (relation_name) => ({
        relation_name,
        owner_name: "neondb_owner",
        rls_enabled: true,
        rls_forced: true,
        policy_count: 0,
        runtime_has_crud: false,
        public_has_crud: false,
      }),
    ),
  };
}

test("environment parser accepts only manual main and the direct owner", () => {
  const env = {
    DIRECT_URL: URL,
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    CASE_CORRECTNESS_PRODUCTION_SCOPE_STAGE: "restart",
  };
  assert.equal(
    parseCaseCorrectnessProductionScopeEnvironment(env).identity.username,
    "neondb_owner",
  );
  for (const drift of [
    { GITHUB_ACTIONS: "false" },
    { GITHUB_EVENT_NAME: "push" },
    { GITHUB_REF: "refs/heads/feature" },
    { DIRECT_URL: URL.replace("neondb_owner", "grainline_app_runtime") },
    { DIRECT_URL: URL.replace(".westus3", "-pooler.westus3") },
    { CASE_CORRECTNESS_PRODUCTION_SCOPE_STAGE: "before" },
  ]) {
    assert.throws(() =>
      parseCaseCorrectnessProductionScopeEnvironment({ ...env, ...drift })
    );
  }
});

test("Case ledger accepts only absent restart or exact applied row", () => {
  assert.equal(assertCaseCorrectnessLedger([], "restart"), false);
  assert.equal(assertCaseCorrectnessLedger([caseRow()], "restart"), true);
  assert.equal(assertCaseCorrectnessLedger([caseRow()], "after"), true);
  assert.throws(() => assertCaseCorrectnessLedger([], "after"));
  const wrong = caseRow();
  wrong.checksum = "0".repeat(64);
  assert.throws(() => assertCaseCorrectnessLedger([wrong], "restart"));
  assert.throws(() =>
    assertCaseCorrectnessLedger([caseRow(), caseRow()], "restart")
  );
});

test("scope accepts exact restart and corrected states", async () => {
  assert.equal(
    assertCaseCorrectnessProductionScope(snapshot(false), "restart").state,
    "order-compatible",
  );
  assert.equal(
    assertCaseCorrectnessProductionScope(snapshot(true), "restart").state,
    "case-corrected",
  );
  const final = assertCaseCorrectnessProductionScope(snapshot(true), "after");
  assert.equal(final.orderMigrationCount, 18);
  assert.equal(final.directRuntimeCrud, false);
  const verified = await verifyCaseCorrectnessProductionScope(
    { directUrl: URL, stage: "after" },
    { readSnapshot: async () => snapshot(true) },
  );
  assert.equal(verified.caseCorrectnessApplied, true);
  for (
    let prefixLength = 1;
    prefixLength <= ORDER_COMPATIBLE_REVIEWED_SUCCESSORS.length;
    prefixLength += 1
  ) {
    assert.equal(
      assertCaseCorrectnessProductionScope(
        snapshot(true, prefixLength),
        "after",
      ).state,
      "case-corrected",
    );
  }
});

test("scope rejects incomplete Order predecessor and Case posture drift", () => {
  const incomplete = snapshot(false);
  incomplete.orderLedgerRows.pop();
  assert.throws(() =>
    assertCaseCorrectnessProductionScope(incomplete, "restart")
  );
  const cases = [];
  const add = (mutate) => {
    const value = snapshot(true);
    mutate(value);
    cases.push(value);
  };
  add((value) => { value.caseTables[0].rls_forced = false; });
  add((value) => { value.caseTables[1].runtime_has_crud = true; });
  add((value) => { value.caseTables[2].policy_count = 1; });
  add((value) => { value.caseTables.pop(); });
  add((value) => {
    value.unexpectedLedgerRows.push({
      ...caseRow(),
      migration_name: "20260901170000_unreviewed_successor",
    });
  });
  add((value) => {
    value.orderLedgerRows.splice(
      ORDER_COMPATIBLE_PRODUCTION_MIGRATIONS.length,
      1,
      applied(ORDER_COMPATIBLE_REVIEWED_SUCCESSORS[1]),
    );
  });
  add((value) => {
    value.orderLedgerRows.push(
      applied(ORDER_COMPATIBLE_REVIEWED_SUCCESSORS[0]),
    );
  });
  for (const value of cases) {
    assert.throws(() =>
      assertCaseCorrectnessProductionScope(value, "after")
    );
  }
});
