import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

import {
  parseCaseInvariantProofConfig,
  readDraftTransactionBody,
} from "../scripts/case-case-message-invariant-postgres-proof.mjs";

const proof = fs.readFileSync(
  "scripts/case-case-message-invariant-postgres-proof.mjs",
  "utf8",
);
const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

test("Case invariant proof refuses persistent database targets", () => {
  assert.throws(
    () => parseCaseInvariantProofConfig({}),
    /CASE_INVARIANT_PROOF_DATABASE_URL is required/,
  );
  assert.throws(
    () => parseCaseInvariantProofConfig({
      CASE_INVARIANT_PROOF_DATABASE_URL:
        "postgresql://ci:ci@database.example/grainline_ci",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseCaseInvariantProofConfig({
      CASE_INVARIANT_PROOF_DATABASE_URL:
        "postgresql://ci:ci@127.0.0.1/production",
    }),
    /requires the grainline_ci database/,
  );
  assert.deepEqual(
    parseCaseInvariantProofConfig({
      CASE_INVARIANT_PROOF_DATABASE_URL:
        "postgresql://ci:ci@127.0.0.1/grainline_ci",
    }),
    {
      databaseUrl: "postgresql://ci:ci@127.0.0.1/grainline_ci",
    },
  );
});

test("Case invariant proof strips only reviewed transaction wrappers", () => {
  for (const path of [
    "docs/rls-drafts/case-case-message-invariants.sql",
    "docs/rls-drafts/case-resolution-claim-ledger.sql",
  ]) {
    const body = readDraftTransactionBody(path);
    assert.match(body, /DRAFT ONLY/);
    assert.doesNotMatch(body, /^\s*BEGIN;/m);
    assert.doesNotMatch(body, /^\s*COMMIT;/m);
  }
});

test("Case invariant proof exercises the high-risk rejection paths", () => {
  for (const check of [
    "forged_buyer_author",
    "mixed_active_refund_evidence",
    "stale_refund_snapshot_on_reopen",
    "empty_participant_opening",
    "wrong_order_payment_evidence",
    "claim_without_order_lease",
    "terminal_claim_mutation",
    "unattested_no_effect_release",
    "runtime_direct_claim_read",
  ]) {
    assert.match(proof, new RegExp(`"${check}"`), check);
  }
  assert.match(proof, /SET CONSTRAINTS ALL IMMEDIATE/);
  assert.match(proof, /SET LOCAL ROLE grainline_app_runtime/);
  assert.match(proof, /RELEASED_NO_PROVIDER_EFFECT/);
  assert.match(proof, /openedByPaymentEventId/);
});

test("Case invariant proof is rollback-only and emits no credentials", () => {
  assert.match(proof, /await client\.query\("BEGIN"\)/);
  assert.match(proof, /await client\.query\("ROLLBACK"\)/);
  assert.match(proof, /if \(began\) await client\.query\("ROLLBACK"\)/);
  assert.match(proof, /persistentStagingChanged: false/);
  assert.match(proof, /productionChanged: false/);
  assert.doesNotMatch(proof, /process\.env\.DATABASE_URL/);
  assert.doesNotMatch(proof, /console\.log\(databaseUrl\)/);
});

test("main CI runs the proof after migrations and grant convergence", () => {
  assert.equal(
    packageJson.scripts["audit:rls-case-invariant-drafts"],
    "node scripts/case-case-message-invariant-postgres-proof.mjs",
  );
  assert.match(
    workflow,
    /Apply migrations to CI Postgres[\s\S]*Converge production-style runtime grants after migrations[\s\S]*Prove Case invariant drafts in rollback-only PostgreSQL/,
  );
  assert.match(
    workflow,
    /CASE_INVARIANT_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
});
