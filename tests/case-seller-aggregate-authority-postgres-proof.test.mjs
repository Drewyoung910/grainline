import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  parseCaseSellerAggregateProofConfig,
  runCaseSellerAggregateProof,
} from "../scripts/case-seller-aggregate-authority-postgres-proof.mjs";

const source = fs.readFileSync(
  "scripts/case-seller-aggregate-authority-postgres-proof.mjs",
  "utf8",
);

describe("Case seller aggregate PostgreSQL proof", () => {
  it("refuses remote databases and the wrong local database", () => {
    assert.throws(
      () => parseCaseSellerAggregateProofConfig({}),
      /CASE_SELLER_AGGREGATE_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseCaseSellerAggregateProofConfig({
          CASE_SELLER_AGGREGATE_PROOF_DATABASE_URL:
            "postgresql://proof:secret@example.com:5432/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseCaseSellerAggregateProofConfig({
          CASE_SELLER_AGGREGATE_PROOF_DATABASE_URL:
            "postgresql://proof:secret@127.0.0.1:5432/postgres",
        }),
      /requires the grainline_ci database/,
    );
  });

  it("pins forced-RLS, purpose, denial, database-clock, and lock checks", () => {
    for (const marker of [
      "preflight-zero-residue",
      "catalog-and-grants",
      "forced-rls-source-posture",
      "metrics-active-count-only",
      "seller-and-staff-verification-count",
      "foreign-disabled-verification-denial",
      "guild-and-reinstatement-state-binding",
      "function-only-forced-rls-read",
      "guild-blocking-case-lock",
      "caller-context-unchanged",
      "expected-state-before-cleanup",
    ]) {
      assert.match(source, new RegExp(marker));
    }
    assert.match(source, /Case seller aggregate proof left fixture residue/);
    assert.match(
      source,
      /INSERT INTO public\."SellerProfile" \([\s\S]{0,280}"updatedAt"[\s\S]{0,280}CURRENT_TIMESTAMP/,
    );
    assert.doesNotMatch(source, /has_function_privilege\(\s*'PUBLIC'/);
  });

  const databaseUrl =
    process.env.CASE_SELLER_AGGREGATE_PROOF_DATABASE_URL;
  (databaseUrl ? it : it.skip)(
    "executes all checks in disposable PostgreSQL",
    async () => {
      const result = await runCaseSellerAggregateProof({
        CASE_SELLER_AGGREGATE_PROOF_DATABASE_URL: databaseUrl,
      });
      assert.equal(result.checks.length, 13);
    },
  );
});
