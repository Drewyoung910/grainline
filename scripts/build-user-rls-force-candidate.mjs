#!/usr/bin/env node

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildUserRlsEnableMigration } from "./build-user-rls-enable-candidate.mjs";

const ENABLE_SHA256 =
  "628f1cbb966cde1cb7f05f48ea0c5b890dce074d8f77536b3a67117c0141146f";

export const USER_RLS_FORCE_RELEASE = Object.freeze({
  migrationName: "20261008020000_force_user_rls",
  migrationPath: "prisma/migrations/20261008020000_force_user_rls/migration.sql",
  predecessorMigration: "20261008010000_enable_user_rls",
  predecessorSha256: ENABLE_SHA256,
});

const sha256 = (value) => createHash("sha256").update(value, "utf8").digest("hex");

function replaceOnce(value, from, to, label) {
  const parts = value.split(from);
  assert.equal(parts.length, 2, `${label} source shape drifted`);
  return `${parts[0]}${to}${parts[1]}`;
}

function replaceLast(value, from, to, label) {
  const index = value.lastIndexOf(from);
  assert.notEqual(index, -1, `${label} source shape drifted`);
  return `${value.slice(0, index)}${to}${value.slice(index + from.length)}`;
}

export function buildUserRlsForceMigration(root = process.cwd()) {
  let sql = buildUserRlsEnableMigration(root);
  assert.equal(sha256(sql), ENABLE_SHA256, "reviewed User ENABLE source drifted");

  sql = replaceOnce(
    sql,
    `-- Reviewed policyless User ENABLE and zero-direct authority boundary.
-- Apply only through the exact-main, CI-bound Production workflow after the
-- cross-domain convergence migration and compatible deployment are accepted.`,
    `-- Reviewed policyless User FORCE hardening.
-- Apply only through the exact-main, CI-bound Production workflow after the
-- policyless User ENABLE predecessor and its zero-direct evidence are accepted.`,
    "header",
  );
  sql = replaceOnce(
    sql,
    "pg_catalog.hashtextextended('grainline.user.rls.activation', 0)",
    "pg_catalog.hashtextextended('grainline.user.rls.force', 0)",
    "advisory lock",
  );
  sql = replaceOnce(
    sql,
    `  IF (
    SELECT class.relrowsecurity OR class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."User"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."User"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'User ENABLE requires policyless RLS-off predecessor';
  END IF;`,
    `  IF NOT (
    SELECT class.relrowsecurity AND NOT class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."User"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."User"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'User FORCE requires policyless ENABLE predecessor';
  END IF;`,
    "predecessor posture",
  );
  sql = replaceOnce(
    sql,
    `  IF nonowner_table_acl_count <> 4
     OR nonowner_column_acl_count <> 0
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'SELECT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'INSERT'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'UPDATE'
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_staff_read_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     THEN
    RAISE EXCEPTION 'User ENABLE predecessor grants drifted';
  END IF;`,
    `  IF nonowner_table_acl_count <> 0
     OR nonowner_column_acl_count <> 0
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_staff_read_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     THEN
    RAISE EXCEPTION 'User FORCE predecessor grants drifted';
  END IF;`,
    "predecessor grants",
  );
  sql = replaceOnce(
    sql,
    `      ('20261007160000_converge_user_cross_domain_authorities', 'fad2c67b0ed3ed4d762a7a5d7d491ba8cca1ab33dc6f0253d8dff845933c4302')`,
    `      ('20261007160000_converge_user_cross_domain_authorities', 'fad2c67b0ed3ed4d762a7a5d7d491ba8cca1ab33dc6f0253d8dff845933c4302'),
      ('20261008010000_enable_user_rls', '${ENABLE_SHA256}')`,
    "ENABLE ledger predecessor",
  );
  sql = replaceOnce(
    sql,
    "accepted_migration_count <> 18",
    "accepted_migration_count <> 19",
    "ledger count",
  );
  sql = replaceOnce(
    sql,
    `REVOKE ALL PRIVILEGES ON TABLE public."User"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

ALTER TABLE public."User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."User" NO FORCE ROW LEVEL SECURITY;`,
    `ALTER TABLE public."User" FORCE ROW LEVEL SECURITY;`,
    "posture mutation",
  );
  sql = replaceLast(
    sql,
    "SELECT class.relrowsecurity AND NOT class.relforcerowsecurity",
    "SELECT class.relrowsecurity AND class.relforcerowsecurity",
    "postflight posture",
  );
  sql = sql
    .replaceAll("$grainline_user_enable_", "$grainline_user_force_")
    .replaceAll("User ENABLE", "User FORCE");
  sql = replaceOnce(
    sql,
    "policyless User FORCE predecessor and its zero-direct evidence",
    "policyless User ENABLE predecessor and its zero-direct evidence",
    "header predecessor",
  );

  assert.equal(
    (sql.match(/^ALTER TABLE public\."User" FORCE ROW LEVEL SECURITY;$/gmu) ?? []).length,
    1,
  );
  assert.doesNotMatch(sql, /^ALTER TABLE public\."User" (?:ENABLE|DISABLE|NO FORCE) ROW LEVEL SECURITY;$/gmu);
  assert.doesNotMatch(sql, /^REVOKE ALL PRIVILEGES ON TABLE public\."User"$/gmu);
  return sql;
}

export function verifyCommittedUserRlsForceMigration(root = process.cwd()) {
  const expected = buildUserRlsForceMigration(root);
  const migrationPath = path.join(root, USER_RLS_FORCE_RELEASE.migrationPath);
  const actual = readFileSync(migrationPath, "utf8");
  assert.equal(actual, expected, "committed User FORCE migration is not generated exactly");
  return Object.freeze({
    migrationName: USER_RLS_FORCE_RELEASE.migrationName,
    migrationPath: USER_RLS_FORCE_RELEASE.migrationPath,
    migrationSha256: sha256(actual),
    functionCount: 53,
    runtimeFunctionCount: 34,
    staffFunctionCount: 9,
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const command = process.argv[2] ?? "--verify";
  if (!["--write", "--verify"].includes(command) || process.argv.length > 3) {
    throw new Error("usage: build-user-rls-force-candidate.mjs [--write|--verify]");
  }
  if (command === "--write") {
    const migrationPath = path.join(process.cwd(), USER_RLS_FORCE_RELEASE.migrationPath);
    mkdirSync(path.dirname(migrationPath), { recursive: true });
    writeFileSync(migrationPath, buildUserRlsForceMigration(), "utf8");
  }
  process.stdout.write(`${JSON.stringify(verifyCommittedUserRlsForceMigration())}\n`);
}
