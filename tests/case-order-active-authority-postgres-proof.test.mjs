import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  parseCaseOrderActiveProofConfig,
  runCaseOrderActiveProof,
} from "../scripts/case-order-active-authority-postgres-proof.mjs";

const source = fs.readFileSync(
  "scripts/case-order-active-authority-postgres-proof.mjs",
  "utf8",
);

describe("Case-aware Order PostgreSQL proof", () => {
  it("refuses remote databases and the wrong local database", () => {
    assert.throws(
      () => parseCaseOrderActiveProofConfig({}),
      /CASE_ORDER_ACTIVE_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseCaseOrderActiveProofConfig({
          CASE_ORDER_ACTIVE_PROOF_DATABASE_URL:
            "postgresql://proof:secret@example.com:5432/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseCaseOrderActiveProofConfig({
          CASE_ORDER_ACTIVE_PROOF_DATABASE_URL:
            "postgresql://proof:secret@127.0.0.1:5432/postgres",
        }),
      /requires the grainline_ci database/,
    );
  });

  it("pins forced-RLS, grant, relationship, retention and race checks", () => {
    assert.match(source, /catalog-and-grants/);
    assert.match(source, /forced-rls-source-posture/);
    assert.match(source, /participant-active-and-terminal-results/);
    assert.match(source, /foreign-disabled-deleted-and-missing-denial/);
    assert.match(source, /mixed_seller_order_invariant_rejected/);
    assert.match(source, /empty_order_invariant_rejected/);
    assert.match(source, /function-only-forced-rls-case-read/);
    assert.match(source, /fixed-retention-targets-and-rollback/);
    assert.match(source, /retention-skip-locked-race/);
    assert.match(source, /order-lock-serializes-case-open/);
    assert.match(source, /opening-message/);
    assert.match(source, /caller-context-unchanged/);
    assert.match(source, /preflight-zero-residue/);
    assert.match(source, /Case-aware Order proof left fixture residue/);
    for (const table of [
      "SellerProfile",
      "Listing",
      "OrderShippingRateQuote",
    ]) {
      assert.match(
        source,
        new RegExp(
          `INSERT INTO public\\."${table}" \\([\\s\\S]{0,260}"updatedAt"[\\s\\S]{0,260}CURRENT_TIMESTAMP`,
        ),
      );
    }
    assert.doesNotMatch(source, /has_function_privilege\(\s*'PUBLIC'/);
  });

  const databaseUrl = process.env.CASE_ORDER_ACTIVE_PROOF_DATABASE_URL;
  (databaseUrl ? it : it.skip)(
    "executes all checks in disposable PostgreSQL",
    async () => {
      const result = await runCaseOrderActiveProof({
        CASE_ORDER_ACTIVE_PROOF_DATABASE_URL: databaseUrl,
      });
      assert.equal(result.checks.length, 13);
    },
  );
});
