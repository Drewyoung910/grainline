import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  CASE_ACTIVATION_MIGRATION,
  CASE_FORCE_MIGRATION,
  CASE_FORCE_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  CASE_FORCE_DRAFT_SHA256,
  CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION_SHA256,
  buildCaseForceCandidate,
} from "../scripts/stage-case-force-migration.mjs";
import {
  CASE_FORCE_RELEASE_PHASE,
  CASE_FORCE_ROLLBACK_DRAFT_SHA256,
  verifyCaseForceRelease,
} from "../scripts/verify-case-force-release.mjs";

const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const release = fs.readFileSync(
  "docs/case-force-production-release.md",
  "utf8",
);
const forceProof = fs.readFileSync(
  "scripts/case-force-postgres-proof.mjs",
  "utf8",
);
const protectedTables = [
  "Case",
  "CaseMessage",
  "CaseMessageAttachment",
];
const normalizedRelease = release.replace(/\s+/g, " ");

test("Case FORCE release is byte-identical to the reviewed draft", () => {
  const candidate = buildCaseForceCandidate();
  const migration = fs.readFileSync(
    `prisma/migrations/${CASE_FORCE_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.equal(migration, candidate.migration);
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "531bb44a9be15b8817baf717c09a4293f4aaa53ce3cabda8ae8311eb2f61a9a0",
  );
  assert.match(release, new RegExp(CASE_FORCE_DRAFT_SHA256));
  assert.match(
    release,
    new RegExp(CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION_SHA256),
  );
  assert.match(release, new RegExp(candidate.migrationSha256));
  assert.match(release, new RegExp(CASE_FORCE_ROLLBACK_DRAFT_SHA256));
});

test("Case FORCE migration is posture-only and exact", () => {
  const migration = fs.readFileSync(
    `prisma/migrations/${CASE_FORCE_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.equal(
    (
      migration.match(
        /^ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" FORCE ROW LEVEL SECURITY;$/gm,
      ) ?? []
    ).length,
    protectedTables.length,
  );
  assert.doesNotMatch(
    migration,
    /^\s*(?:CREATE POLICY|DROP POLICY|GRANT|REVOKE|INSERT INTO|UPDATE public\.|DELETE FROM|TRUNCATE|CREATE FUNCTION|ALTER FUNCTION)\b/im,
  );
  assert.doesNotMatch(migration, /NO FORCE ROW LEVEL SECURITY/);
  assert.match(migration, /owner_session_count <> 0/);
  assert.match(migration, /IF accepted_table_count <> 3/);
  assert.match(migration, /IF accepted_function_count <> 27/);
  assert.match(migration, /IF invariant_definer_function_count <> 5/);
  assert.match(migration, /IF invariant_invoker_function_count <> 3/);
  assert.match(migration, /member\.rolname = 'neondb_owner'/);
  assert.match(migration, /grantor\.rolname = 'cloud_admin'/);
  assert.match(migration, /membership\.admin_option/);
  assert.match(migration, /NOT membership\.inherit_option/);
  assert.match(migration, /NOT membership\.set_option/);
  assert.match(migration, /WITH RECURSIVE restricted_members/);
  assert.match(migration, /WHERE rolname <> 'neondb_owner'/);
  assert.doesNotMatch(migration, /must remain membership-free/);
});

test("Case FORCE verifier pins the exact predecessor and complete tree", () => {
  const result = verifyCaseForceRelease();
  assert.equal(result.phase, CASE_FORCE_RELEASE_PHASE);
  assert.equal(result.activationMigration, CASE_ACTIVATION_MIGRATION);
  assert.equal(result.forceMigration, CASE_FORCE_MIGRATION);
  assert.equal(result.migrationTreeSha256, CASE_FORCE_MIGRATION_TREE_SHA256);
  assert.equal(result.rlsEnabled, true);
  assert.equal(result.rlsForced, true);
  assert.equal(result.policyCount, 0);
  assert.equal(result.runtimeTablePrivileges, 0);
  assert.equal(result.rowDataChanged, false);
  const migrationNames = fs.readdirSync("prisma/migrations", {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.equal(
    computeMigrationTreeSha256("prisma/migrations", migrationNames),
    CASE_FORCE_MIGRATION_TREE_SHA256,
  );
});

test("Case FORCE PostgreSQL proof reuses denial checks with FORCE required", () => {
  assert.match(forceProof, /CASE_FORCE_PROOF_DATABASE_URL/);
  assert.match(forceProof, /forceExpected: true/);
  assert.match(forceProof, /grainline-case-force-proof/);
  assert.equal(
    JSON.parse(fs.readFileSync("package.json", "utf8")).scripts?.[
      "audit:rls-case-force-postgres"
    ],
    "node scripts/case-force-postgres-proof.mjs",
  );
});

test("CI proves Phase A before restoring and proving Case FORCE", () => {
  assert.match(ci, /SAVED_SEARCH_RLS_DEPLOY_PHASE: case-force-reviewed/);
  assert.match(ci, /npm run audit:rls-case-force-release/);
  assert.match(
    ci,
    /Isolate the exact Case FORCE release until Phase A passes[\s\S]*Restore the exact Case activation release[\s\S]*Apply the exact Case activation release[\s\S]*Prove promoted Case activation under the runtime role[\s\S]*Restore the exact Case FORCE release[\s\S]*Apply the exact Case FORCE release[\s\S]*Audit FORCE-hardened runtime grants and RLS catalog[\s\S]*Prove FORCE-hardened Case authority under the runtime role/,
  );
  assert.match(ci, /CASE_FORCE_PROOF_DATABASE_URL/);
});

test("runtime grant convergence accepts only uniform Case ENABLE or FORCE", () => {
  const provision = fs.readFileSync(
    "scripts/provision-runtime-db-role.sql",
    "utf8",
  );
  const caseBoundary = provision.slice(
    provision.indexOf("), case_activation AS ("),
    provision.indexOf("-- DirectUpload starts as a legacy CRUD table"),
  );
  assert.match(caseBoundary, /bool_and\([\s\S]*relrowsecurity[\s\S]*policy_count = 0/);
  assert.match(
    caseBoundary,
    /COUNT\(DISTINCT relforcerowsecurity\) = 1 AS active/,
  );
  assert.match(
    caseBoundary,
    /NOT relrowsecurity[\s\S]*NOT relforcerowsecurity[\s\S]*policy_count = 0[\s\S]*AS clean_predecessor/,
  );
  assert.match(caseBoundary, /WHERE NOT active AND NOT clean_predecessor/);
});

test("production workflow permits only the reviewed Case FORCE tree", () => {
  const guard = production.indexOf(
    "SAVED_SEARCH_RLS_DEPLOY_PHASE: case-force-reviewed",
  );
  const verifier = production.indexOf(
    "npm run audit:rls-case-force-release",
  );
  const deploy = production.indexOf("npx prisma migrate deploy");
  assert.ok(guard >= 0);
  assert.ok(verifier > guard);
  assert.ok(deploy > verifier);
  assert.doesNotMatch(
    production,
    /vercel|CASE_EVIDENCE_ATTACHMENTS_ENABLED|prisma migrate resolve/i,
  );
});

test("release record keeps all later mutations outside this boundary", () => {
  assert.match(normalizedRelease, /not been merged or applied/i);
  assert.match(normalizedRelease, /Case evidence remains disabled/);
  assert.match(normalizedRelease, /does not deploy/i);
  assert.match(normalizedRelease, /Order, payment and shipping/i);
  assert.match(release, new RegExp(CASE_FORCE_MIGRATION_TREE_SHA256));
});
