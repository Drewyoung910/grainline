import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  parseCaseReplyAuthorityProofConfig,
} from "../scripts/case-reply-authority-postgres-proof.mjs";

test("Case-reply PostgreSQL proof is loopback-only and database-pinned", () => {
  assert.deepEqual(
    parseCaseReplyAuthorityProofConfig({
      CASE_REPLY_AUTHORITY_PROOF_DATABASE_URL:
        "postgresql://ci:secret@127.0.0.1:5432/grainline_ci",
    }),
    {
      databaseUrl:
        "postgresql://ci:secret@127.0.0.1:5432/grainline_ci",
    },
  );
  assert.throws(
    () =>
      parseCaseReplyAuthorityProofConfig({
        CASE_REPLY_AUTHORITY_PROOF_DATABASE_URL:
          "postgresql://ci:secret@database.example.com:5432/grainline_ci",
      }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () =>
      parseCaseReplyAuthorityProofConfig({
        CASE_REPLY_AUTHORITY_PROOF_DATABASE_URL:
          "postgresql://ci:secret@127.0.0.1:5432/production",
      }),
    /requires the grainline_ci database/,
  );
});

test("CI runs the Case-reply proof only after migration and grant convergence", () => {
  const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
  const migrateAt = workflow.indexOf("Apply migrations to CI Postgres");
  const grantsAt = workflow.indexOf(
    "Converge production-style runtime grants after migrations",
  );
  const proofAt = workflow.indexOf(
    "Prove Case-reply authority in ephemeral PostgreSQL",
  );
  const finalGrantAuditAt = workflow.indexOf(
    "Audit final runtime grants and RLS catalog",
  );
  assert.ok(migrateAt >= 0);
  assert.ok(grantsAt > migrateAt);
  assert.ok(proofAt > grantsAt);
  assert.ok(finalGrantAuditAt > proofAt);
  assert.match(
    workflow,
    /CASE_REPLY_AUTHORITY_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
});

test("Case-reply proof covers authority, source binding, replay, locks, rollback, and cleanup", () => {
  const source = fs.readFileSync(
    "scripts/case-reply-authority-postgres-proof.mjs",
    "utf8",
  );
  for (const marker of [
    "forged_actor_rejected",
    "party_under_review_rejected",
    "suspended_recipient_rejected",
    "foreign_upload_rejected",
    "wrong_case_upload_rejected",
    "unverified_upload_rejected",
    "\\$4::text",
    "CASE_MESSAGE_ATTACHMENT",
    "proveReplay",
    "waitForLock",
    "proveConcurrency",
    "proveRollback",
    "persistentStagingChanged: false",
    "productionChanged: false",
  ]) {
    assert.match(source, new RegExp(marker));
  }
});
