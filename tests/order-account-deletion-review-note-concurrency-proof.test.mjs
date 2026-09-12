import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import yaml from "js-yaml";
import {
  proofConfig,
  runProof,
} from "../scripts/order-account-deletion-review-note-concurrency-proof.mjs";

const migration = fs.readFileSync(
  "prisma/migrations/20260905020000_prepare_order_account_deletion_authority/migration.sql",
  "utf8",
);
const workflowSource = fs.readFileSync(
  ".github/workflows/order-account-deletion-concurrency-proof.yml",
  "utf8",
);
const proofSource = fs.readFileSync(
  "scripts/order-account-deletion-review-note-concurrency-proof.mjs",
  "utf8",
);

describe("Order account-deletion review-note concurrency proof", () => {
  it("admits only its exact disposable loopback database identity", () => {
    const accepted =
      "postgresql://account_deletion_proof_owner:synthetic@127.0.0.1:5432/grainline_account_deletion_concurrency_proof";
    assert.equal(proofConfig({
      ORDER_ACCOUNT_DELETION_CONCURRENCY_PROOF_DATABASE_URL: accepted,
    }).connectionString, accepted);
    for (const rejected of [
      undefined,
      "postgres://account_deletion_proof_owner@127.0.0.1:5432/grainline_account_deletion_concurrency_proof",
      "postgresql://account_deletion_proof_owner@localhost:5432/grainline_account_deletion_concurrency_proof",
      "postgresql://other@127.0.0.1:5432/grainline_account_deletion_concurrency_proof",
      "postgresql://account_deletion_proof_owner@127.0.0.1:5432/other",
      "postgresql://account_deletion_proof_owner@127.0.0.1:5432/grainline_account_deletion_concurrency_proof?sslmode=disable",
    ]) {
      assert.throws(() => proofConfig({
        ORDER_ACCOUNT_DELETION_CONCURRENCY_PROOF_DATABASE_URL: rejected,
      }));
    }
  });

  it("redacts the current locked tuple without a stale materialized candidate", () => {
    assert.match(
      migration,
      /SET "reviewNote" = public\.grainline_account_deletion_redact_text_core\([\s\S]*target_order\."reviewNote",[\s\S]*sensitive_values/u,
    );
    assert.doesNotMatch(migration, /review_candidates|MATERIALIZED/u);
  });

  it("runs the real lock-barrier proof only in an isolated PostgreSQL 16 job", () => {
    assert.match(proofSource, /proofServerHostAccepted\(identity\.rows\[0\]\.host, process\.env\.GITHUB_ACTIONS === "true"\)/u);
    const workflow = yaml.load(workflowSource);
    assert.deepEqual(workflow.permissions, { contents: "read" });
    assert.doesNotMatch(workflowSource, /workflow_dispatch|secrets\./u);
    const job = workflow.jobs["review-note-concurrency"];
    assert.equal(job.services.postgres.image, "postgres:16");
    assert.equal(job.services.postgres.env.POSTGRES_USER, "account_deletion_proof_owner");
    assert.equal(
      job.services.postgres.env.POSTGRES_DB,
      "grainline_account_deletion_concurrency_proof",
    );
    const serialized = JSON.stringify(job.steps);
    assert.match(serialized, /order-account-deletion-review-note-concurrency-proof\.test\.mjs/u);
    assert.match(serialized, /127\.0\.0\.1:5432\/grainline_account_deletion_concurrency_proof/u);
  });

  it("preserves a concurrent staff note while scrubbing only the actor order", {
    skip: process.env.ORDER_ACCOUNT_DELETION_CONCURRENCY_PROOF !== "loopback-ci-postgres16",
  }, async () => {
    assert.deepEqual(await runProof(), {
      lockObserved: true,
      concurrentStaffNotePreserved: true,
      actorOrderScrubbed: true,
      unrelatedOrderPreserved: true,
      staffAuditPreserved: true,
    });
  });
});
