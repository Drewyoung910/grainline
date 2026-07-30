import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  CASE_AUTHORITY_OPERATIONS,
} from "../scripts/case-case-message-authority-catalog.mjs";

const readModeSql = fs.readFileSync(
  "docs/rls-drafts/case-case-message-read-mode.sql",
  "utf8",
);
const activationSql = fs.readFileSync(
  "docs/rls-drafts/case-case-message-activation.sql",
  "utf8",
);
const rollbackSql = fs.readFileSync(
  "docs/rls-drafts/case-case-message-activation-rollback.sql",
  "utf8",
);
const forceSql = fs.readFileSync(
  "docs/rls-drafts/case-case-message-force.sql",
  "utf8",
);

const protectedTables = [
  "Case",
  "CaseMessage",
  "CaseMessageAttachment",
];

test("Case read-mode draft converges exactly four bounded projections", () => {
  const alteredFunctions = [
    ...readModeSql.matchAll(
      /ALTER FUNCTION public\.(grainline_[a-z0-9_]+)\([\s\S]*?\)\s+SECURITY DEFINER;/g,
    ),
  ].map((match) => match[1]);

  assert.deepEqual(alteredFunctions, [
    "grainline_case_get",
    "grainline_case_get_by_order",
    "grainline_case_staff_active_count",
    "grainline_case_export_page",
  ]);
  assert.doesNotMatch(
    readModeSql,
    /\b(?:CREATE POLICY|ENABLE ROW LEVEL SECURITY|FORCE ROW LEVEL SECURITY)\b/,
  );
  assert.doesNotMatch(
    readModeSql,
    /\b(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/i,
  );
});

test("Case activation draft is policyless and removes every direct grant", () => {
  assert.doesNotMatch(activationSql, /\bCREATE POLICY\b/i);
  assert.equal(
    (activationSql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length,
    protectedTables.length,
  );
  assert.equal(
    (activationSql.match(/NO FORCE ROW LEVEL SECURITY/g) ?? []).length,
    protectedTables.length,
  );

  for (const table of protectedTables) {
    assert.match(
      activationSql,
      new RegExp(
        `REVOKE ALL ON TABLE public\\."${table}"\\s+FROM PUBLIC, grainline_app_runtime;`,
      ),
    );
    assert.doesNotMatch(
      activationSql,
      new RegExp(`GRANT [^;]+ON TABLE public\\."${table}"`, "i"),
    );
  }
  assert.doesNotMatch(
    activationSql,
    /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/im,
  );
});

test("Case activation draft freezes before inspecting mutable posture", () => {
  const lockAt = activationSql.indexOf("LOCK TABLE");
  const preflightAt = activationSql.indexOf(
    "DO $grainline_case_activation_preflight$",
  );
  assert.ok(lockAt > 0);
  assert.ok(preflightAt > lockAt);
  assert.match(activationSql, /IN ACCESS EXCLUSIVE MODE;/);
  assert.match(
    activationSql,
    /hashtextextended\('grainline\.case\.rls\.activation', 0\)/,
  );
});

test("Case activation preflight pins all 28 fixed catalog operations", () => {
  const catalogSlice = activationSql.slice(
    activationSql.indexOf("INTO function_count"),
    activationSql.indexOf("IF function_count <> 28"),
  );
  const catalogNames = [
    ...catalogSlice.matchAll(/'(grainline_[a-z0-9_]+)'/g),
  ].map((match) => match[1]);

  assert.equal(new Set(catalogNames).size, 28);
  assert.equal(catalogNames.length, 28);
  assert.deepEqual(
    [...catalogNames].sort(),
    CASE_AUTHORITY_OPERATIONS
      .map((operation) => operation.candidateFunctionName)
      .sort(),
  );
  const runtimeSlice = activationSql.slice(
    activationSql.indexOf("INTO runtime_function_count"),
    activationSql.indexOf("IF runtime_function_count <> 27"),
  );
  const runtimeNames = [
    ...runtimeSlice.matchAll(/'(grainline_[a-z0-9_]+)'/g),
  ]
    .map((match) => match[1])
    .filter((name) => name !== "grainline_app_runtime");
  assert.deepEqual(
    [...runtimeNames].sort(),
    CASE_AUTHORITY_OPERATIONS
      .filter((operation) => operation.runtimeExecute)
      .map((operation) => operation.candidateFunctionName)
      .sort(),
  );
  assert.ok(catalogNames.includes("grainline_case_lock_core"));
  assert.match(activationSql, /IF runtime_function_count <> 27/);
  assert.match(activationSql, /IF private_function_count <> 1/);
});

test("Case activation refuses missing or unvalidated invariant objects", () => {
  assert.match(activationSql, /IF validated_constraint_count <> 6/);
  assert.match(
    activationSql,
    /Case activation requires CaseMessage\.authorKind NOT NULL/,
  );
  assert.match(activationSql, /IF invariant_trigger_count <> 9/);
  assert.match(activationSql, /IF invariant_function_count <> 8/);
  assert.match(activationSql, /constraint_row\.convalidated/);
  assert.match(activationSql, /trigger_row\.tgenabled = 'O'/);
});

test("Case initial rollback restores only the predecessor table boundary", () => {
  assert.equal(
    (rollbackSql.match(/DISABLE ROW LEVEL SECURITY/g) ?? []).length,
    protectedTables.length,
  );
  assert.doesNotMatch(rollbackSql, /\bCREATE POLICY\b/i);
  for (const table of protectedTables) {
    assert.match(
      rollbackSql,
      new RegExp(
        `GRANT SELECT, INSERT, UPDATE, DELETE\\s+ON TABLE public\\."${table}"`,
      ),
    );
  }
  assert.doesNotMatch(
    rollbackSql,
    /^\s*(?:INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE)\b/im,
  );
});

test("Case FORCE draft is posture-only and covers exactly three tables", () => {
  assert.equal(
    (
      forceSql.match(
        /ALTER TABLE public\."[^"]+" FORCE ROW LEVEL SECURITY/g,
      ) ?? []
    ).length,
    protectedTables.length,
  );
  assert.doesNotMatch(
    forceSql,
    /^\s*(?:CREATE POLICY|DROP POLICY|GRANT|REVOKE|INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|CREATE FUNCTION|ALTER FUNCTION)\b/im,
  );
});
