import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  loadReviewedMigration,
  parseProofConfig,
} from "../scripts/direct-upload-legacy-repair-postgres-proof.mjs";

const migration = readFileSync(
  "prisma/migrations/20260726185700_repair_direct_upload_legacy_references/migration.sql",
  "utf8",
);
const proof = readFileSync(
  "scripts/direct-upload-legacy-repair-postgres-proof.mjs",
  "utf8",
);
const workflow = readFileSync(
  ".github/workflows/direct-upload-authority-postgres-proof.yml",
  "utf8",
);
const ci = readFileSync(".github/workflows/ci.yml", "utf8");
const plan = readFileSync(
  "docs/direct-upload-legacy-repair-plan.md",
  "utf8",
);
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("DirectUpload legacy repair migration and PostgreSQL proof", () => {
  it("refuses non-loopback and non-disposable database targets", () => {
    assert.throws(
      () => parseProofConfig({}),
      /DIRECT_UPLOAD_LEGACY_REPAIR_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseProofConfig({
          DIRECT_UPLOAD_LEGACY_REPAIR_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseProofConfig({
          DIRECT_UPLOAD_LEGACY_REPAIR_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires the grainline_ci database/,
    );
    assert.deepEqual(
      parseProofConfig({
        DIRECT_UPLOAD_LEGACY_REPAIR_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
      },
    );
  });

  it("pins exact inspected scope and derives authority from locked sources", () => {
    const loaded = loadReviewedMigration(() => migration);
    assert.match(loaded.sha256, /^[a-f0-9]{64}$/);
    assert.match(migration, /LOCK TABLE[\s\S]*public\."DirectUpload"/);
    assert.match(migration, /IN SHARE ROW EXCLUSIVE MODE/);
    assert.match(migration, /upload_count <> 3 OR reference_count <> 0/);
    assert.match(migration, /case_attachment_count <> 0/);
    assert.match(migration, /unknown_claim_count <> 3/);
    assert.match(migration, /grainline_direct_upload_sync_listing/);
    assert.match(migration, /grainline_direct_upload_sync_seller_profile/);
    assert.match(migration, /grainline_direct_upload_sync_review/);
    assert.match(migration, /grainline_direct_upload_sync_blog_post/);
    assert.match(migration, /grainline_direct_upload_sync_commission_request/);
    assert.match(migration, /grainline_direct_upload_sync_seller_broadcast/);
    assert.match(migration, /grainline_direct_upload_sync_legacy_message/);
    assert.match(migration, /referenced_total <> 2/);
    assert.match(migration, /matching_source_count <> 2/);
    assert.match(migration, /normalized_upload_count NOT BETWEEN 1 AND 2/);
    assert.match(migration, /orphan_upload_count NOT BETWEEN 1 AND 2/);
    assert.match(migration, /repair_at \+ interval '7 days'/);
    assert.match(migration, /\bposition\('\.\.' IN upload\.key\)/);
    assert.doesNotMatch(migration, /pg_catalog\.position/);
    assert.doesNotMatch(
      migration,
      /INSERT\s+INTO\s+public\."DirectUpload"\b/i,
    );
    assert.doesNotMatch(
      migration,
      /ALTER TABLE public\."DirectUpload".*(?:ENABLE|FORCE) ROW LEVEL SECURITY/is,
    );
    assert.doesNotMatch(migration, /\bGRANT\b|\bREVOKE\b/);
  });

  it("proves both aggregate-valid upload partitions with exact migration SQL", () => {
    assert.match(proof, /await client\.query\(migration\.sql\)/);
    assert.match(proof, /"two-distinct-uploads"/);
    assert.match(proof, /"one-reused-upload"/);
    assert.match(proof, /active_reference_count: 2/);
    assert.match(proof, /referenced_upload_count: 2/);
    assert.match(proof, /referenced_upload_count: 1/);
    assert.match(proof, /delayed_orphan_count: 1/);
    assert.match(proof, /delayed_orphan_count: 2/);
    assert.match(proof, /assertDisposableDatabaseIsEmpty/);
    assert.match(proof, /await cleanupFixtures\(client\)\.catch/);
    assert.match(proof, /productionChanged: false/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
  });

  it("records the exact production boundary and keeps later activation separate", () => {
    assert.match(plan, /ff6abe15badc54132ce9df70ba56f93723d332ac/);
    assert.match(plan, /30389331036/);
    assert.match(plan, /30390887295/);
    assert.match(plan, /30393344198/);
    assert.match(plan, /2 first-party durable source URLs/);
    assert.match(plan, /do \*\*not\*\* prove two distinct lifecycle rows/);
    assert.match(plan, /120 untracked historical URLs/);
    assert.match(plan, /cleanup eligibility seven days in the future/);
    assert.match(plan, /recoverable Neon backup\/child branch/);
    assert.match(plan, /post-repair-verification/);
    assert.match(plan, /verify-prelaunch-direct-upload-legacy-repair/);
    assert.match(plan, /does not authorize either later step/);
  });

  it("runs the proof against PostgreSQL 16 in focused and main CI", () => {
    assert.match(workflow, /image: postgres:16/);
    assert.match(workflow, /agent\/direct-upload-legacy-repair-20260728/);
    assert.match(
      workflow,
      /DIRECT_UPLOAD_LEGACY_REPAIR_PROOF_DATABASE_URL/,
    );
    assert.match(
      workflow,
      /npm run audit:rls-direct-upload-legacy-repair/,
    );
    assert.match(
      workflow,
      /Isolate the repair migration for exact SQL diagnostics[\s\S]*Apply the compatible baseline migration tree[\s\S]*Restore the exact repair migration[\s\S]*psql "\$DIRECT_URL"[\s\S]*--echo-errors[\s\S]*20260726185700_repair_direct_upload_legacy_references\/migration\.sql[\s\S]*prisma migrate resolve[\s\S]*--applied 20260726185700_repair_direct_upload_legacy_references/,
    );
    assert.match(
      ci,
      /Prove DirectUpload legacy repair in ephemeral PostgreSQL[\s\S]*audit:rls-direct-upload-legacy-repair/,
    );
    assert.equal(
      packageJson.scripts["audit:rls-direct-upload-legacy-repair"],
      "node scripts/direct-upload-legacy-repair-postgres-proof.mjs",
    );
  });
});
