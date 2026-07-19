import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { describe, it } from "node:test";

const {
  collectSavedSearchPolicyIssues,
  deriveGrantInventory,
  normalizeRlsPolicyExpression,
  SAVED_SEARCH_RLS_FORCE_EXPECTED,
} = await import("../scripts/audit-runtime-db-grants.mjs");

const RUNTIME_ROLE = "grainline_app_runtime";
const RLS_MIGRATION_PATH =
  "prisma/migrations/20260717030000_enable_saved_search_rls/migration.sql";
const FORCE_RLS_MIGRATION_PATH =
  "prisma/migrations/20260720060000_force_saved_search_rls/migration.sql";
const phaseAIt = existsSync(RLS_MIGRATION_PATH) ? it : it.skip;
const phaseBIt = existsSync(FORCE_RLS_MIGRATION_PATH) ? it : it.skip;

function source(path) {
  return readFileSync(path, "utf8");
}

function exactPolicyRows() {
  const ownerPredicate =
    `(("userId" = NULLIF(current_setting('app.user_id'::text, true), ''::text)))`;
  return [
    {
      rls_enabled: true,
      rls_forced: true,
      policy_name: "saved_search_owner_delete",
      policy_command: "d",
      policy_permissive: true,
      policy_roles: [RUNTIME_ROLE],
      using_expression: ownerPredicate,
      check_expression: null,
    },
    {
      rls_enabled: true,
      rls_forced: true,
      policy_name: "saved_search_owner_insert",
      policy_command: "a",
      policy_permissive: true,
      policy_roles: [RUNTIME_ROLE],
      using_expression: null,
      check_expression: ownerPredicate,
    },
    {
      rls_enabled: true,
      rls_forced: true,
      policy_name: "saved_search_owner_select",
      policy_command: "r",
      policy_permissive: true,
      policy_roles: [RUNTIME_ROLE],
      using_expression: ownerPredicate,
      check_expression: null,
    },
  ];
}

describe("SavedSearch exact RLS policy guardrails", () => {
  phaseAIt("adds only the reviewed SELECT, INSERT, and DELETE owner policies", () => {
    const migration = source(RLS_MIGRATION_PATH);
    const policyStatements = [...migration.matchAll(/\bCREATE\s+POLICY\b/gi)];

    assert.equal(policyStatements.length, 3);
    assert.match(migration, /CREATE POLICY "saved_search_owner_select"[\s\S]*?FOR SELECT[\s\S]*?TO grainline_app_runtime[\s\S]*?USING \([\s\S]*?"userId" = NULLIF\(current_setting\('app\.user_id', true\), ''\)/);
    assert.match(migration, /CREATE POLICY "saved_search_owner_insert"[\s\S]*?FOR INSERT[\s\S]*?TO grainline_app_runtime[\s\S]*?WITH CHECK \([\s\S]*?"userId" = NULLIF\(current_setting\('app\.user_id', true\), ''\)/);
    assert.match(migration, /CREATE POLICY "saved_search_owner_delete"[\s\S]*?FOR DELETE[\s\S]*?TO grainline_app_runtime[\s\S]*?USING \([\s\S]*?"userId" = NULLIF\(current_setting\('app\.user_id', true\), ''\)/);
    assert.doesNotMatch(migration, /\bFOR\s+(?:UPDATE|ALL)\b/i);
    assert.doesNotMatch(migration, /\bTO\s+PUBLIC\b/i);
    assert.match(migration, /ALTER TABLE public\."SavedSearch" ENABLE ROW LEVEL SECURITY/);
    assert.match(migration, /ALTER TABLE public\."SavedSearch" NO FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /ALTER TABLE public\."SavedSearch" FORCE ROW LEVEL SECURITY/);
    assert.ok(
      migration.indexOf('NO FORCE ROW LEVEL SECURITY')
        < migration.indexOf('ENABLE ROW LEVEL SECURITY'),
    );
    assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
    assert.match(migration, /SET LOCAL statement_timeout = '30s'/);
  });

  phaseBIt("forces only the already reviewed Phase A policy set after fail-closed live checks", () => {
    const migration = source(FORCE_RLS_MIGRATION_PATH);

    assert.doesNotMatch(migration, /\bCREATE\s+POLICY\b/i);
    assert.match(migration, /ALTER TABLE public\."SavedSearch" FORCE ROW LEVEL SECURITY/);
    assert.doesNotMatch(migration, /ALTER TABLE public\."SavedSearch" DISABLE ROW LEVEL SECURITY/);
    assert.match(migration, /must begin phase B with ENABLE and NO FORCE/);
    assert.match(migration, /exactly three reviewed policies before FORCE/);
    assert.match(migration, /saved_search_owner_select/);
    assert.match(migration, /saved_search_owner_insert/);
    assert.match(migration, /saved_search_owner_delete/);
    assert.match(migration, /pg_stat_activity/);
    assert.match(migration, /pid <> pg_backend_pid\(\)/);
    assert.match(migration, /owner-backed application session drain is incomplete/);
    assert.match(migration, /SET LOCAL lock_timeout = '5s'/);
    assert.match(migration, /SET LOCAL statement_timeout = '30s'/);
    assert.match(migration, /FORCE ROW LEVEL SECURITY did not persist/);
    assert.equal(SAVED_SEARCH_RLS_FORCE_EXPECTED, true);
  });

  phaseAIt("fails closed before policy creation when role, ownership, grants, or prior-policy checks fail", () => {
    const migration = source(RLS_MIGRATION_PATH);
    const firstPolicy = migration.indexOf("CREATE POLICY");

    assert.ok(firstPolicy > 0);
    const revokeUpdate = migration.indexOf(
      'REVOKE UPDATE ON TABLE public."SavedSearch" FROM grainline_app_runtime',
    );
    assert.ok(migration.indexOf("rolsuper") < firstPolicy);
    assert.ok(migration.indexOf("rolcreatedb") < firstPolicy);
    assert.ok(migration.indexOf("rolcreaterole") < firstPolicy);
    assert.ok(migration.indexOf("rolinherit") < firstPolicy);
    assert.ok(migration.indexOf("rolcanlogin") < firstPolicy);
    assert.ok(migration.indexOf("rolreplication") < firstPolicy);
    assert.ok(migration.indexOf("rolbypassrls") < firstPolicy);
    assert.ok(migration.indexOf("pg_auth_members") < firstPolicy);
    assert.ok(migration.indexOf("saved_search_owner_oid = runtime_oid") < firstPolicy);
    assert.ok(migration.indexOf("saved_search_owner_oid <> current_role_oid") < firstPolicy);
    assert.ok(migration.indexOf("FROM pg_policy") < firstPolicy);
    assert.ok(migration.indexOf("has_schema_privilege") < firstPolicy);
    assert.ok(migration.indexOf("has_table_privilege") < firstPolicy);
    assert.ok(migration.indexOf("aclexplode") < firstPolicy);
    assert.ok(migration.indexOf("FROM pg_attribute") < firstPolicy);
    assert.ok(revokeUpdate > 0 && revokeUpdate < firstPolicy);
    assert.match(
      migration.slice(0, firstPolicy),
      /exactly direct non-grantable SELECT\/INSERT\/DELETE and no UPDATE/,
    );
    assert.match(migration.slice(0, firstPolicy), /WHERE acl\.grantee = runtime_oid/);
    assert.match(migration.slice(0, firstPolicy), /WHERE acl\.grantee = 0/);
    assert.doesNotMatch(migration.slice(0, firstPolicy), /acl\.grantee IN \(0, runtime_oid\)/);
    assert.match(
      migration.slice(0, firstPolicy),
      /PUBLIC must have no table privileges on public\."SavedSearch"/,
    );
    assert.match(
      migration.slice(0, firstPolicy),
      /must be NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/,
    );
    assert.match(
      migration.slice(0, firstPolicy),
      /current_database\(\) = 'grainline_ci' AND current_user = 'ci'/,
    );
    assert.match(
      migration.slice(0, firstPolicy),
      /must be LOGIN outside the guarded grainline_ci\/ci migration fixture/,
    );
    assert.match(
      migration.slice(0, firstPolicy),
      /must have no column privileges/,
    );
    for (const privilege of ["SELECT", "INSERT", "DELETE"]) {
      assert.match(
        migration.slice(0, firstPolicy),
        new RegExp(`has_table_privilege\\('grainline_app_runtime', 'public\\.\"SavedSearch\"', '${privilege}'\\)`),
      );
    }
    assert.match(
      migration.slice(0, firstPolicy),
      /OR has_table_privilege\('grainline_app_runtime', 'public\."SavedSearch"', 'UPDATE'\)/,
    );
    assert.match(
      migration.slice(0, firstPolicy),
      /ARRAY\['DELETE', 'INSERT', 'SELECT'\]::text\[\]/,
    );
  });

  it("derives SavedSearch as an exact-policy table from migration source", () => {
    assert.deepEqual(
      deriveGrantInventory().rlsPolicyTables,
      existsSync(RLS_MIGRATION_PATH) ? ["SavedSearch"] : [],
    );
  });

  it("normalizes PostgreSQL text casts without weakening the owner predicate", () => {
    assert.equal(
      normalizeRlsPolicyExpression(
        `(("userId" = NULLIF(current_setting('app.user_id'::text, true), ''::text)))`,
      ),
      `"userId" = NULLIF(current_setting('app.user_id', true), '')`,
    );
    assert.notEqual(
      normalizeRlsPolicyExpression("true"),
      normalizeRlsPolicyExpression(
        `"userId" = NULLIF(current_setting('app.user_id', true), '')`,
      ),
    );
    assert.notEqual(
      normalizeRlsPolicyExpression(
        `"userId" = NULLIF(current_setting('app.user_id::text', true), '')`,
      ),
      normalizeRlsPolicyExpression(
        `"userId" = NULLIF(current_setting('app.user_id', true), '')`,
      ),
      "cast normalization must not rewrite text inside SQL string literals",
    );
  });

  it("accepts only the exact role, command, and expression shape", () => {
    assert.deepEqual(
      collectSavedSearchPolicyIssues(exactPolicyRows(), RUNTIME_ROLE),
      [],
    );

    const drifted = exactPolicyRows();
    drifted[0] = {
      ...drifted[0],
      policy_roles: ["PUBLIC"],
      using_expression: "true",
    };
    drifted[1] = {
      ...drifted[1],
      policy_command: "w",
      check_expression: `"userId" = current_setting('app.user_id', true)`,
    };
    drifted[2] = {
      ...drifted[2],
      policy_permissive: false,
    };
    drifted.push({
      ...drifted[2],
      policy_name: "saved_search_public_select",
      policy_roles: ["PUBLIC"],
      using_expression: "true",
    });
    const issues = collectSavedSearchPolicyIssues(drifted, RUNTIME_ROLE).join("\n");

    assert.match(issues, /unexpected policy saved_search_public_select/);
    assert.match(issues, /saved_search_owner_delete has roles PUBLIC/);
    assert.match(issues, /saved_search_owner_delete has an unexpected USING expression/);
    assert.match(issues, /saved_search_owner_insert has command w, expected a/);
    assert.match(issues, /saved_search_owner_insert has an unexpected WITH CHECK expression/);
    assert.match(issues, /saved_search_owner_select must be PERMISSIVE/);
  });

  it("rejects missing policies, disabled RLS, or missing Phase B FORCE state", () => {
    const rows = exactPolicyRows().slice(1).map((row) => ({
      ...row,
      rls_enabled: false,
      rls_forced: false,
    }));
    const issues = collectSavedSearchPolicyIssues(rows, RUNTIME_ROLE).join("\n");

    assert.match(issues, /must have ROW LEVEL SECURITY enabled/);
    assert.match(issues, /must have FORCE ROW LEVEL SECURITY enabled/);
    assert.match(issues, /missing policy saved_search_owner_delete/);
    assert.match(
      collectSavedSearchPolicyIssues([], RUNTIME_ROLE).join("\n"),
      /missing expected table SavedSearch/,
    );
  });

  it("keeps the exact drift audit and staging gate addressable from package scripts", () => {
    const pkg = JSON.parse(source("package.json"));
    const audit = source("scripts/audit-runtime-db-grants.mjs");
    const launch = source("docs/launch-checklist.md");
    const runbook = source("docs/runbook.md");

    assert.equal(
      pkg.scripts["audit:rls-saved-search"],
      "node scripts/saved-search-rls-acceptance-gate.mjs",
    );
    assert.match(audit, /export function collectSavedSearchPolicyIssues/);
    assert.match(audit, /export async function readSavedSearchPolicyState/);
    assert.match(audit, /const expectedRlsPolicyTables = new Set\(inventory\.rlsPolicyTables \?\? \[\]\)/);
    assert.match(
      audit,
      /row\.table_name === "SavedSearch" && expectedRlsPolicyTables\.has\("SavedSearch"\)/,
    );
    assert.match(audit, /absent from the reviewed migration inventory/);
    assert.match(audit, /policy_role\.role_oid = 0 THEN 'PUBLIC'/);
    assert.match(audit, /pg_get_expr\(p\.polqual, p\.polrelid\)/);
    assert.match(audit, /pg_get_expr\(p\.polwithcheck, p\.polrelid\)/);
    for (const doc of [launch, runbook]) {
      assert.match(doc, /SAVED_SEARCH_RLS_GATE_CONFIRM=staging-only/);
      assert.match(doc, /SAVED_SEARCH_RLS_GATE_PRODUCTION_DATABASE_ENDPOINT_ID/);
      assert.match(doc, /npm run audit:rls-saved-search/);
      assert.match(doc, /SAVED_SEARCH_RLS_GATE_EVIDENCE_PATH/);
    }
    assert.match(runbook, /Never point the mutating `audit:rls-saved-search` fixture gate at production/);
    assert.match(runbook, /non-mutating catalog\/grant audit/);
    assert.match(launch, /Never run this mutating fixture gate against production/);
  });
});
