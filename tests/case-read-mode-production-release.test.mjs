import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  CASE_READ_MODE_MIGRATION,
  CASE_READ_MODE_MIGRATION_TREE_SHA256,
  computeMigrationTreeSha256,
} from "../scripts/guard-saved-search-rls-deploy.mjs";
import {
  CASE_READ_MODE_DRAFT_SHA256,
  buildCaseReadModeCandidate,
} from "../scripts/stage-case-read-mode-migration.mjs";

const release = fs.readFileSync(
  "docs/case-read-mode-production-release.md",
  "utf8",
);
const workflow = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);

test("Case read-mode release pins exact source, migration, and tree bytes", () => {
  const candidate = buildCaseReadModeCandidate();
  const migration = fs.readFileSync(
    `prisma/migrations/${CASE_READ_MODE_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.equal(migration, candidate.migration);
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "3feeae96ab81fb26a746e01983b1bdb086192dd8319e87add19d42f7805f5193",
  );
  const migrationNames = fs.readdirSync(
    "prisma/migrations",
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);
  assert.equal(
    computeMigrationTreeSha256("prisma/migrations", migrationNames),
    CASE_READ_MODE_MIGRATION_TREE_SHA256,
  );
  assert.match(release, new RegExp(CASE_READ_MODE_DRAFT_SHA256));
  assert.match(release, new RegExp(candidate.migrationSha256));
  assert.match(release, new RegExp(CASE_READ_MODE_MIGRATION_TREE_SHA256));
});

test("Case read-mode release is compatible and exact", () => {
  const migration = fs.readFileSync(
    `prisma/migrations/${CASE_READ_MODE_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.equal(
    (migration.match(/^ALTER FUNCTION public\.grainline_case_/gm) ?? []).length,
    4,
  );
  assert.equal(
    (migration.match(/^REVOKE ALL ON FUNCTION public\.grainline_case_/gm) ?? [])
      .length,
    4,
  );
  assert.equal(
    (migration.match(/^GRANT EXECUTE ON FUNCTION public\.grainline_case_/gm) ?? [])
      .length,
    4,
  );
  assert.doesNotMatch(
    migration,
    /(?:ENABLE|FORCE) ROW LEVEL SECURITY|CREATE POLICY/i,
  );
  assert.doesNotMatch(
    migration,
    /(?:GRANT|REVOKE)[\s\S]{0,160}\bON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"/i,
  );
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
  );
  assert.match(workflow, /case-read-mode-reviewed/);
  assert.doesNotMatch(workflow, /case-(?:activation|force)-reviewed/);
});

test("Case read-mode release records the threat boundary and live predecessor", () => {
  assert.match(
    release,
    /13091acd428d86aa7da8ada143695ed66a3c6947/,
  );
  assert.match(release, /30552049441/);
  assert.match(
    release,
    /e27f287d6cf797dc2bc91b5805322c633263a6202ecf9968365831d547646847/,
  );
  assert.match(
    release,
    /pooled\s+runtime can still pass a syntactically valid local User id/,
  );
  assert.match(release, /RLS remains off with\s+zero policies/);
  assert.match(
    release,
    /Do not combine this migration with policyless ENABLE/,
  );
});
