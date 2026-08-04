import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  CASE_ACTIVATION_MIGRATION,
  CASE_ACTIVATION_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  CASE_ACTIVATION_DRAFT_SHA256,
  buildCaseActivationCandidate,
} from "../scripts/stage-case-activation-migration.mjs";
import {
  CASE_ACTIVATION_ROLLBACK_SHA256,
  CASE_FORCE_DRAFT_SHA256,
  CASE_FORCE_ROLLBACK_DRAFT_SHA256,
} from "../scripts/verify-case-activation-release.mjs";

const release = fs.readFileSync(
  "docs/case-activation-production-release.md",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);

test("Case activation release pins exact source, migration, and tree bytes", () => {
  const candidate = buildCaseActivationCandidate();
  const migration = fs.readFileSync(
    `prisma/migrations/${CASE_ACTIVATION_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.equal(migration, candidate.migration);
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "df2469781d766612b3d7de97f989cbbf5f37d569d382a79bd51e66a3553ff19f",
  );
  const migrationNames = fs.readdirSync("prisma/migrations", {
    withFileTypes: true,
  })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.equal(
    computeMigrationTreeSha256("prisma/migrations", migrationNames),
    CASE_ACTIVATION_MIGRATION_TREE_SHA256,
  );
  for (const hash of [
    CASE_ACTIVATION_DRAFT_SHA256,
    candidate.migrationSha256,
    CASE_ACTIVATION_MIGRATION_TREE_SHA256,
    CASE_ACTIVATION_ROLLBACK_SHA256,
    CASE_FORCE_DRAFT_SHA256,
    CASE_FORCE_ROLLBACK_DRAFT_SHA256,
  ]) {
    assert.match(release, new RegExp(hash));
  }
});

test("Case activation release is policyless ENABLE and excludes later boundaries", () => {
  const migration = fs.readFileSync(
    `prisma/migrations/${CASE_ACTIVATION_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.equal(
    (migration.match(/^ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" ENABLE ROW LEVEL SECURITY;$/gm) ?? []).length,
    3,
  );
  assert.equal(
    (migration.match(/^ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" NO FORCE ROW LEVEL SECURITY;$/gm) ?? []).length,
    3,
  );
  assert.equal(
    (migration.match(/^REVOKE ALL ON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"$/gm) ?? []).length,
    3,
  );
  assert.doesNotMatch(migration, /CREATE POLICY|DROP POLICY/i);
  assert.doesNotMatch(migration, /(?<!NO )FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(migration, /^\s*GRANT\b/im);
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
  );
  assert.match(release, /Case evidence remains disabled/);
  assert.match(release, /Order\/payment\/shipping RLS group/);
});

test("CI holds Case activation until authority and predecessor proofs pass", () => {
  assert.match(ci, /SAVED_SEARCH_RLS_DEPLOY_PHASE: case-activation-reviewed/);
  assert.match(ci, /npm run audit:rls-case-activation-release/);
  assert.match(
    ci,
    /Isolate the exact Case activation until authority proofs pass[\s\S]*Prove Case invariant drafts in rollback-only PostgreSQL[\s\S]*Prove compatible Case production postflight under the runtime role[\s\S]*Restore the exact Case activation release[\s\S]*Apply the exact Case activation release[\s\S]*Converge activated Case runtime grants[\s\S]*Audit final runtime grants and RLS catalog[\s\S]*Prove promoted Case activation under the runtime role/,
  );
  assert.match(ci, /CASE_ACTIVATION_PROOF_DATABASE_URL/);
  assert.doesNotMatch(ci, /prisma migrate resolve/);
});

test("production workflow gates exact Case release before Prisma deploy", () => {
  const verifier = production.indexOf(
    "npm run audit:rls-case-activation-release",
  );
  const deploy = production.indexOf("npx prisma migrate deploy");
  assert.ok(verifier >= 0);
  assert.ok(deploy > verifier);
  assert.match(
    production,
    /SAVED_SEARCH_RLS_DEPLOY_PHASE: case-activation-reviewed/,
  );
  assert.doesNotMatch(production, /vercel|CASE_EVIDENCE_ATTACHMENTS_ENABLED/i);
});

test("release records exact accepted predecessors and an unchanged production boundary", () => {
  for (const value of [
    "30413133843",
    "30877508811",
    "30881395864",
    "30924905247",
  ]) {
    assert.match(release, new RegExp(value));
  }
  assert.match(
    release,
    /does not claim that the migration is merged or\s+live/,
  );
  assert.match(release, /Production remains\s+unchanged/);
});
