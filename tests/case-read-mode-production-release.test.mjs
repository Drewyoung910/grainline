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
const recipientReadProof = fs.readFileSync(
  "scripts/case-recipient-read-authority-postgres-proof.mjs",
  "utf8",
);
const accountExportProof = fs.readFileSync(
  "scripts/case-account-export-authority-postgres-proof.mjs",
  "utf8",
);
const recipientReadPreparation = fs.readFileSync(
  "prisma/migrations/20260729055000_prepare_case_recipient_read_authority/migration.sql",
  "utf8",
);
const accountExportPreparation = fs.readFileSync(
  "prisma/migrations/20260729059000_prepare_case_account_export_authority/migration.sql",
  "utf8",
);
const invariantPostgresProof = fs.readFileSync(
  "scripts/case-case-message-invariant-postgres-proof.mjs",
  "utf8",
);

function functionBody(source, functionName) {
  const match = source.match(
    new RegExp(
      `AS (\\$${functionName}\\$)([\\s\\S]*?)\\1;`,
    ),
  );
  assert.ok(match, `missing source body for ${functionName}`);
  return match[2];
}

test("Case read-mode release pins exact source, migration, and tree bytes", () => {
  const candidate = buildCaseReadModeCandidate();
  const migration = fs.readFileSync(
    `prisma/migrations/${CASE_READ_MODE_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.equal(migration, candidate.migration);
  assert.equal(
    createHash("sha256").update(migration).digest("hex"),
    "c237720b87ac81e03f6dd3558012076497b9d54412abdb71234c450ed36ee1a7",
  );
  const migrationNames = fs.readdirSync(
    "prisma/migrations",
    { withFileTypes: true },
  )
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => name.localeCompare(CASE_READ_MODE_MIGRATION) <= 0);
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
  assert.equal((migration.match(/pg_catalog\.md5\(actual\.prosrc\)/g) ?? []).length, 2);
  assert.equal((migration.match(/runtime_execute_grantable/g) ?? []).length, 4);
  assert.equal((migration.match(/other_role_execute_count/g) ?? []).length, 4);
  assert.match(migration, /function overload catalog drifted/);
  assert.match(migration, /language_name IS DISTINCT FROM 'plpgsql'/);
  for (const [functionName, source] of [
    ["grainline_case_get", recipientReadPreparation],
    ["grainline_case_get_by_order", recipientReadPreparation],
    ["grainline_case_staff_active_count", recipientReadPreparation],
    ["grainline_case_export_page", accountExportPreparation],
  ]) {
    const sourceMd5 = createHash("md5")
      .update(functionBody(source, functionName))
      .digest("hex");
    assert.equal(
      (migration.match(new RegExp(sourceMd5, "g")) ?? []).length,
      2,
      `${functionName} source digest must be pinned preflight and postflight`,
    );
  }
  assert.match(workflow, /case-resolution-window-reviewed/);
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

test("Case read-mode release records the exact accepted production proof", () => {
  assert.match(
    release,
    /eadfe234e6543790953d1737bb78b4cdfc366d5a/,
  );
  assert.match(release, /30558713676/);
  assert.match(release, /90925844061/);
  assert.match(release, /30559726020/);
  assert.match(release, /90929329701/);
  assert.match(
    release,
    /a61462f355c46b161932261ed75031875c8022f20a490e50f32166a870267d9a/,
  );
  assert.match(release, /repeatable-read, read-only/);
  assert.match(release, /RLS off, FORCE off,\s+zero policies/);
  assert.match(release, /postflight changed no production state/);
});

test("Case read-mode release keeps downstream PostgreSQL catalog proofs aligned", () => {
  assert.match(recipientReadProof, /security_definer: true/);
  assert.doesNotMatch(recipientReadProof, /security_definer: false/);
  assert.match(accountExportProof, /prosecdef: true/);
  assert.doesNotMatch(accountExportProof, /prosecdef: false/);
  assert.doesNotMatch(
    invariantPostgresProof,
    /READ_MODE_DRAFT|readModeBody/,
  );
});
