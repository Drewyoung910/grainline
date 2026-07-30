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
  for (const draft of [
    "docs/rls-drafts/case-case-message-invariants.sql",
    "docs/rls-drafts/case-case-message-activation.sql",
    "docs/rls-drafts/case-case-message-activation-rollback.sql",
    "docs/rls-drafts/case-case-message-force.sql",
    "docs/rls-drafts/case-case-message-force-rollback.sql",
  ]) {
    const body = readDraftTransactionBody(draft);
    assert.match(body, /DRAFT ONLY/, draft);
    assert.doesNotMatch(body, /^\s*BEGIN;/m, draft);
    assert.doesNotMatch(body, /^\s*COMMIT;/m, draft);
  }
  assert.doesNotMatch(
    proof,
    /readDraftTransactionBody\(CLAIM_DRAFT\)/,
  );
  assert.doesNotMatch(
    proof,
    /readDraftTransactionBody\(READ_MODE_DRAFT\)|client\.query\(readModeBody\)/,
  );
});

test("Case invariant proof exercises the high-risk rejection paths", () => {
  for (const check of [
    "forged_buyer_author",
    "mixed_active_refund_evidence",
    "blank_refund_provider_evidence",
    "stale_refund_snapshot_on_reopen",
    "empty_participant_opening",
    "wrong_order_payment_evidence",
    "forged_case_dispute_source",
    "provider_evidence_before_recorded_state",
    "provider_evidence_rebinding",
    "claim_without_order_lease",
    "terminal_claim_mutation",
    "unattested_no_effect_release",
    "runtime_direct_claim_read",
    "runtime_direct_dispute_application_read",
    "runtime_direct_seller_refund_application_read",
    "forged_dispute_order_charge",
    "superseded_dispute_source",
    "forged_seller_refund_actor",
    "forged_seller_refund_source",
    "forged_staff_resolution_finalizer",
    "null_provider_outcome",
    "ambiguous_provider_cannot_assert_refund",
    "forged_provider_record_actor",
    "null_provider_reconciliation_action",
    "non_admin_provider_reconciliation",
    "released_claim_cannot_finalize",
    "legacy_case_relationship_preflight",
    "legacy_message_author_preflight",
    "activated_runtime_direct_case_read",
    "activated_runtime_direct_message_insert",
  ]) {
    assert.match(proof, new RegExp(`"${check}"`), check);
  }
  assert.match(proof, /SET CONSTRAINTS ALL IMMEDIATE/);
  assert.match(proof, /SET LOCAL ROLE grainline_app_runtime/);
  assert.match(proof, /RELEASED_NO_PROVIDER_EFFECT/);
  assert.match(proof, /openedByPaymentEventId/);
  assert.match(proof, /CaseStripeDisputeApplication/);
  assert.match(proof, /grainline_case_stripe_dispute_apply/);
  assert.match(proof, /CaseSellerRefundApplication/);
  assert.match(proof, /grainline_case_seller_refund_apply/);
  assert.match(proof, /CASE_SELLER_REFUND_APPLIED/);
  assert.match(proof, /grainline_case_staff_resolution_prepare/);
  assert.match(proof, /grainline_case_staff_resolution_provider_record/);
  assert.match(proof, /grainline_case_staff_resolution_finalize/);
  assert.match(proof, /grainline_case_staff_resolution_reconcile/);
  assert.match(proof, /RECONCILIATION_REQUIRED/);
  assert.match(proof, /release_payment_event_count: 0/);
  assert.match(proof, /refundAmountCents: null/);
  assert.match(proof, /action, "replay"/);
  assert.match(proof, /replayedAfterTerminal/);
  assert.match(proof, /checks: 55/);
  assert.match(proof, /provePolicylessActivation/);
  assert.match(proof, /case_force_candidate/);
});

test("seller-refund proof parameters have one explicit PostgreSQL type", () => {
  const sellerRefundProof = proof.match(
    /async function proveSellerRefundAuthority\(client\) \{([\s\S]*?)\n\}\n\nasync function proveStaffResolutionAuthority/,
  )?.[1] ?? "";
  assert.equal(
    (sellerRefundProof.match(/\$4::varchar\(255\)/g) ?? []).length,
    4,
  );
  assert.doesNotMatch(sellerRefundProof, /\$4(?!::varchar\(255\))/);
  assert.doesNotMatch(sellerRefundProof, /\$4::text/);
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

test("promoted invariant proof reconstructs pre-migration state only inside rollback transactions", () => {
  assert.match(
    proof,
    /async function resetPromotedInvariantForProof\(client\)/,
  );
  assert.match(proof, /constraint_count: 6/);
  assert.match(proof, /function_count: 8/);
  assert.match(proof, /trigger_count: 9/);
  assert.match(
    proof,
    /await resetPromotedInvariantForProof\(client\);\s+await seedBaseFixtures/,
  );
  assert.match(
    proof,
    /await client\.query\("BEGIN"\);\s+began = true;\s+await resetPromotedInvariantForProof\(client\);\s+await client\.query\(draftBody\)/,
  );
  assert.doesNotMatch(proof, /process\.env\.DIRECT_URL/);
});

test("Case invariant proof flushes deferred triggers before the later FORCE release", () => {
  const flushAt = proof.indexOf(
    'await client.query("SET CONSTRAINTS ALL IMMEDIATE")',
    proof.indexOf("activated_runtime_direct_message_insert"),
  );
  const forceAt = proof.indexOf("await client.query(forceBody)");
  assert.ok(flushAt > 0, "deferred-trigger flush is missing");
  assert.ok(forceAt > flushAt, "FORCE runs before deferred triggers are flushed");
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
  assert.doesNotMatch(
    proof,
    /READ_MODE_DRAFT|readModeBody/,
    "the promoted read-mode migration must not be replayed as a draft",
  );
});
