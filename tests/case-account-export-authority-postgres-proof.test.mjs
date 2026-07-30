import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  parseCaseAccountExportProofConfig,
  runCaseAccountExportAuthorityProof,
} from "../scripts/case-account-export-authority-postgres-proof.mjs";

const source = fs.readFileSync(
  "scripts/case-account-export-authority-postgres-proof.mjs",
  "utf8",
);

describe("Case account-export PostgreSQL proof", () => {
  it("refuses remote databases and the wrong local database", () => {
    assert.throws(
      () => parseCaseAccountExportProofConfig({}),
      /CASE_ACCOUNT_EXPORT_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () => parseCaseAccountExportProofConfig({
        CASE_ACCOUNT_EXPORT_PROOF_DATABASE_URL:
          "postgresql://proof:secret@example.com:5432/grainline_ci",
      }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () => parseCaseAccountExportProofConfig({
        CASE_ACCOUNT_EXPORT_PROOF_DATABASE_URL:
          "postgresql://proof:secret@127.0.0.1:5432/postgres",
      }),
      /requires the grainline_ci database/,
    );
  });

  it("pins real policies, stable paging, denial, context, and cleanup checks", () => {
    for (const marker of [
      "preflight-zero-residue",
      "catalog-and-grants",
      "forced-participant-policies-installed",
      "participant-stable-keyset",
      "participant-only-and-disabled-denial",
      "invalid-input-denial",
      "unset-context-direct-read-zero",
      "transaction-local-context",
      "expected-state-before-cleanup",
      "cleanup-zero-residue",
    ]) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(source, /CREATE POLICY case_account_export_proof_user_self/);
    assert.match(
      source,
      /CREATE POLICY case_account_export_proof_case_participant/,
    );
    assert.match(source, /Case account-export proof left fixture residue/);
    assert.match(source, /INSERT INTO public\."OrderItem"/);
    assert.match(source, /opening-message/);
    assert.doesNotMatch(source, /has_function_privilege\(\s*'PUBLIC'/);
  });

  const databaseUrl = process.env.CASE_ACCOUNT_EXPORT_PROOF_DATABASE_URL;
  (databaseUrl ? it : it.skip)(
    "executes all checks in disposable PostgreSQL",
    async () => {
      const result = await runCaseAccountExportAuthorityProof({
        CASE_ACCOUNT_EXPORT_PROOF_DATABASE_URL: databaseUrl,
      });
      assert.equal(result.checks.length, 11);
    },
  );
});
