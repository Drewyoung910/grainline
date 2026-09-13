import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseCaseAccountDeletionProofConfig,
} from "../scripts/case-account-deletion-authority-postgres-proof.mjs";

const source = readFileSync(
  "scripts/case-account-deletion-authority-postgres-proof.mjs",
  "utf8",
);

describe("Case account-deletion PostgreSQL proof", () => {
  it("refuses missing, remote, and wrong-database targets", () => {
    assert.throws(
      () => parseCaseAccountDeletionProofConfig({}),
      /CASE_ACCOUNT_DELETION_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseCaseAccountDeletionProofConfig({
        CASE_ACCOUNT_DELETION_PROOF_DATABASE_URL:
          "postgresql://user:secret@example.com:5432/grainline_ci",
      }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () => parseCaseAccountDeletionProofConfig({
        CASE_ACCOUNT_DELETION_PROOF_DATABASE_URL:
          "postgresql://user:secret@127.0.0.1:5432/postgres",
      }),
      /requires the grainline_ci database/,
    );
  });

  it("accepts only the disposable loopback CI database", () => {
    const databaseUrl =
      "postgresql://ci:ci@127.0.0.1:5432/grainline_ci?sslmode=disable";
    assert.deepEqual(
      parseCaseAccountDeletionProofConfig({
        CASE_ACCOUNT_DELETION_PROOF_DATABASE_URL: databaseUrl,
      }),
      { databaseUrl },
    );
  });

  it("pins the authority, denial, race, rollback, and cleanup checks", () => {
    for (const marker of [
      "catalog-and-grants",
      "forced-zero-policy-posture",
      "active-case-fail-closed",
      "blocker-clears-only-after-active-case-removal",
      "forged-source-denial",
      "isolation-fail-closed",
      "direct-runtime-boundary",
      "transaction-rollback",
      "user-lock-serialization",
      "seller-order-lock-serialization",
      "derived-redaction-commit",
      "length-bounded-redaction",
      "idempotent-retry",
      "cleanup-zero-residue",
    ]) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(source, /SET LOCAL ROLE grainline_app_runtime/);
    assert.match(source, /FORCE ROW LEVEL SECURITY/);
    assert.match(source, /NO FORCE ROW LEVEL SECURITY/);
    assert.match(source, /SET LOCAL lock_timeout = '200ms'/);
    assert.match(source, /55P03/);
    assert.match(source, /25001/);
    assert.match(source, /55000/);
    assert.match(source, /SHARED_HISTORY_EMAIL/);
    assert.match(source, /LENGTH_BOUNDARY_BODY/);
    assert.match(source, /TARGET_SHORT_TOKEN/);
    assert.match(source, /assertRedactedProtectedRows/);
    assert.match(source, /INSERT INTO public\."OrderItem"/);
    assert.match(source, /activeOpeningMessage/);
    assert.match(source, /fixture residue/);
    assert.match(source, /CASE_CORRECTNESS_EXPECTED === "1"/);
    assert.match(
      source,
      /assert\.equal\(checks\.length, correctnessExpected \? 17 : 16\)/,
    );
  });
});
