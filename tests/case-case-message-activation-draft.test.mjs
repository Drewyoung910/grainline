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
const forceRollbackSql = fs.readFileSync(
  "docs/rls-drafts/case-case-message-force-rollback.sql",
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

test("Case posture drafts inspect PUBLIC as the ACL pseudo-grantee", () => {
  for (const [name, sql] of [
    ["activation", activationSql],
    ["activation rollback", rollbackSql],
    ["FORCE", forceSql],
    ["FORCE rollback", forceRollbackSql],
  ]) {
    assert.doesNotMatch(
      sql,
      /has_(?:table|any_column)_privilege\(\s*'PUBLIC'/s,
      name,
    );
    assert.match(sql, /acl\.grantee = 0/, name);
  }

  const predecessorSlice = activationSql.slice(
    activationSql.indexOf("INTO table_count"),
    activationSql.indexOf("IF table_count <> 3"),
  );
  for (const privilege of ["SELECT", "INSERT", "UPDATE", "DELETE"]) {
    assert.match(
      predecessorSlice,
      new RegExp(
        `has_table_privilege\\(\\s*'grainline_app_runtime',\\s*class\\.oid,\\s*'${privilege}'\\s*\\)`,
        "s",
      ),
    );
  }
  assert.doesNotMatch(
    predecessorSlice,
    /has_table_privilege\([\s\S]*?'SELECT,INSERT,UPDATE,DELETE'/,
  );
});

test("Case activation preflight pins all 27 fixed catalog operations", () => {
  const catalogSlice = activationSql.slice(
    activationSql.indexOf("INTO function_count"),
    activationSql.indexOf("IF function_count <> 27"),
  );
  const catalogNames = [
    ...catalogSlice.matchAll(/'(grainline_[a-z0-9_]+)'/g),
  ].map((match) => match[1]);

  assert.equal(new Set(catalogNames).size, 27);
  assert.equal(catalogNames.length, 27);
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
  assert.ok(!catalogNames.includes("grainline_case_lock_core"));
  assert.match(activationSql, /IF runtime_function_count <> 27/);
  assert.doesNotMatch(activationSql, /private_function_count/);
});

test("Case activation refuses missing or unvalidated invariant objects", () => {
  assert.match(activationSql, /IF validated_constraint_count <> 6/);
  assert.match(
    activationSql,
    /Case activation requires CaseMessage\.authorKind NOT NULL/,
  );
  assert.match(activationSql, /IF invariant_trigger_count <> 9/);
  assert.match(
    activationSql,
    /IF invariant_definer_function_count <> 5/,
  );
  assert.match(
    activationSql,
    /IF invariant_invoker_function_count <> 3/,
  );
  assert.match(activationSql, /constraint_row\.convalidated/);
  assert.match(activationSql, /trigger_row\.tgenabled = 'O'/);
  const expectedDefinerInvariants = [
    "grainline_case_relationship_valid",
    "grainline_case_message_author_valid",
    "grainline_case_message_maintain_thread",
    "grainline_case_opening_evidence_valid",
    "grainline_case_attachment_parent_valid",
  ];
  const definerInvariantSlice = activationSql.slice(
    activationSql.indexOf("INTO invariant_definer_function_count"),
    activationSql.indexOf("IF invariant_definer_function_count <> 5"),
  );
  assert.deepEqual(
    [...definerInvariantSlice.matchAll(/'(grainline_case_[a-z0-9_]+)'/g)].map(
      (match) => match[1],
    ),
    expectedDefinerInvariants,
  );

  const expectedInvokerInvariants = [
    "grainline_case_authority_fields_immutable",
    "grainline_case_status_transition_valid",
    "grainline_case_message_authority_fields_immutable",
  ];
  const invokerInvariantSlice = activationSql.slice(
    activationSql.indexOf("INTO invariant_invoker_function_count"),
    activationSql.indexOf("IF invariant_invoker_function_count <> 3"),
  );
  assert.deepEqual(
    [...invokerInvariantSlice.matchAll(/'(grainline_case_[a-z0-9_]+)'/g)].map(
      (match) => match[1],
    ),
    expectedInvokerInvariants,
  );
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
  assert.match(forceSql, /current_user = 'neondb_owner'/);
  assert.match(
    forceSql,
    /current_user = 'ci'[\s\S]*current_database\(\) = 'grainline_ci'/,
  );
  assert.match(forceSql, /runtime_role\.rolbypassrls/);
  assert.match(forceSql, /owner_session_count <> 0/);
  assert.match(forceSql, /IF accepted_function_count <> 27/);
  assert.match(forceSql, /IF invariant_definer_function_count <> 5/);
  assert.match(forceSql, /IF invariant_invoker_function_count <> 3/);
});

test("Case FORCE rollback restores only policyless ENABLE posture", () => {
  assert.equal(
    (
      forceRollbackSql.match(
        /ALTER TABLE public\."[^"]+" NO FORCE ROW LEVEL SECURITY/g,
      ) ?? []
    ).length,
    protectedTables.length,
  );
  assert.doesNotMatch(
    forceRollbackSql,
    /^\s*(?:CREATE POLICY|DROP POLICY|GRANT|REVOKE|INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|CREATE FUNCTION|ALTER FUNCTION)\b/im,
  );
  assert.doesNotMatch(forceRollbackSql, /DISABLE ROW LEVEL SECURITY/);
});
