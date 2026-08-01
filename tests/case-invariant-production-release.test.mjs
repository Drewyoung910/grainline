import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  CASE_INVARIANT_MIGRATION,
  CASE_INVARIANT_MIGRATION_TREE_SHA256,
  CASE_READ_MODE_MIGRATION,
  DIRECT_UPLOAD_RETIREMENT_MIGRATION,
  computeMigrationTreeSha256,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  CASE_INVARIANT_DRAFT_SHA256,
  buildCaseInvariantCandidate,
} from "../scripts/stage-case-invariant-migration.mjs";

const release = fs.readFileSync(
  "docs/case-invariant-production-release.md",
  "utf8",
);
const workflow = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("Case invariant release pins exact source, migration, and tree bytes", () => {
  const candidate = buildCaseInvariantCandidate();
  const migrationPath =
    `prisma/migrations/${CASE_INVARIANT_MIGRATION}/migration.sql`;
  const migration = fs.readFileSync(migrationPath, "utf8");
  assert.equal(migration, candidate.migration);
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "4557c044740a6cee0d30b78ebe1d9bb300b43613cf979fba01d2571e3c4d1fa1",
  );
  const migrationNames = fs.readdirSync(
    "prisma/migrations",
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => ![
      CASE_READ_MODE_MIGRATION,
      DIRECT_UPLOAD_RETIREMENT_MIGRATION,
    ].includes(name));
  assert.equal(
    computeMigrationTreeSha256("prisma/migrations", migrationNames),
    CASE_INVARIANT_MIGRATION_TREE_SHA256,
  );
  assert.match(release, new RegExp(CASE_INVARIANT_DRAFT_SHA256));
  assert.match(release, new RegExp(candidate.migrationSha256));
  assert.match(release, new RegExp(CASE_INVARIANT_MIGRATION_TREE_SHA256));
});

test("Case invariant release excludes read-mode and RLS activation", () => {
  const migration = fs.readFileSync(
    `prisma/migrations/${CASE_INVARIANT_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.doesNotMatch(
    migration,
    /(?:ENABLE|FORCE) ROW LEVEL SECURITY|CREATE POLICY/i,
  );
  assert.doesNotMatch(
    migration,
    /(?:GRANT|REVOKE)[\s\S]{0,160}\bON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"/i,
  );
  assert.match(workflow, /direct-upload-retirement-reviewed/);
  assert.doesNotMatch(workflow, /case-(?:activation|force)-reviewed/);
});

test("Case invariant release keeps a read-only pooled-runtime postflight", () => {
  assert.equal(
    packageJson.scripts["ops:case-invariant-postflight"],
    "node scripts/case-invariant-production-postflight.mjs",
  );
  assert.equal(
    packageJson.scripts["audit:rls-case-invariant-candidate"],
    "node scripts/stage-case-invariant-migration.mjs --verify",
  );
  assert.match(release, /BEGIN TRANSACTION READ ONLY/);
  assert.match(release, /transaction_read_only=on/);
  assert.match(release, /runtime role receives `42501`/);
  assert.match(release, /Do not combine read-mode, ENABLE or FORCE/);
});

test("Case invariant release records the exact production boundary", () => {
  assert.match(
    release,
    /13091acd428d86aa7da8ada143695ed66a3c6947/,
  );
  assert.match(release, /30552049441/);
  assert.match(release, /90902923987/);
  assert.match(
    release,
    /case-invariant-production-postflight-13091acd428d86aa7da8ada143695ed66a3c6947\.json/,
  );
  assert.match(
    release,
    /e27f287d6cf797dc2bc91b5805322c633263a6202ecf9968365831d547646847/,
  );
  assert.match(release, /RLS off, FORCE\s+off, zero policies/);
  assert.match(release, /No application deployment was performed/);
});
