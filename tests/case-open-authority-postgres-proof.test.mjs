import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  parseCaseOpenAuthorityProofConfig,
} from "../scripts/case-open-authority-postgres-proof.mjs";

const proof = readFileSync(
  "scripts/case-open-authority-postgres-proof.mjs",
  "utf8",
);
const workflow = readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

describe("Case-open authority PostgreSQL proof", () => {
  it("refuses persistent and non-disposable database targets", () => {
    assert.throws(
      () => parseCaseOpenAuthorityProofConfig({}),
      /CASE_OPEN_AUTHORITY_PROOF_DATABASE_URL is required/,
    );
    assert.throws(
      () =>
        parseCaseOpenAuthorityProofConfig({
          CASE_OPEN_AUTHORITY_PROOF_DATABASE_URL:
            "postgresql://ci:ci@database.example/grainline_ci",
        }),
      /refuses a non-loopback database/,
    );
    assert.throws(
      () =>
        parseCaseOpenAuthorityProofConfig({
          CASE_OPEN_AUTHORITY_PROOF_DATABASE_URL:
            "postgresql://ci:ci@127.0.0.1/production",
        }),
      /requires the grainline_ci database/,
    );
    assert.deepEqual(
      parseCaseOpenAuthorityProofConfig({
        CASE_OPEN_AUTHORITY_PROOF_DATABASE_URL:
          "postgresql://ci:ci@127.0.0.1/grainline_ci",
      }),
      {
        databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
      },
    );
  });

  it("proves source authority, lifecycle fences, replay, lock wait, and rollback", () => {
    for (const check of [
      "foreign_buyer_rejected",
      "unpaid_order_rejected",
      "multi_seller_item_invariant_rejected",
      "refund_sentinel_rejected",
      "refund_event_rejected",
      "pending_order_rejected",
      "label_purchase_rejected",
      "future_estimate_rejected",
      "expired_window_rejected",
      "changed_description_replay_rejected",
      "malformed_replay_audit_rejected",
      "runtime_private_ledger_select_denied",
      "runtime_private_ledger_delete_denied",
      "proveReviewOverride",
      "waitForLock",
      "wait_event_type, \"Lock\"",
      "proveRollback",
      "checks: 19",
    ]) {
      assert.match(proof, new RegExp(check), check);
    }
    assert.match(proof, /SET LOCAL ROLE grainline_app_runtime/);
    assert.match(proof, /persistentStagingChanged: false/);
    assert.match(proof, /productionChanged: false/);
    assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
  });

  it("cleans fixtures and runs after migration and grant convergence in CI", () => {
    assert.match(proof, /async function cleanupFixtures/);
    assert.match(proof, /await cleanupFixtures\(observer\)/);
    assert.equal(
      packageJson.scripts["audit:rls-case-open-authority"],
      "node scripts/case-open-authority-postgres-proof.mjs",
    );
    assert.match(
      workflow,
      /Apply migrations to CI Postgres[\s\S]*Converge production-style runtime grants after migrations[\s\S]*Prove buyer Case-open authority in ephemeral PostgreSQL/,
    );
    assert.match(
      workflow,
      /CASE_OPEN_AUTHORITY_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
    );
  });
});
