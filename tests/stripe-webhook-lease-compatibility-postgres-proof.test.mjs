import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import {
  parseStripeWebhookLeaseCompatibilityProofConfig,
  readStripeWebhookLeaseDraftBody,
} from "../scripts/stripe-webhook-lease-compatibility-postgres-proof.mjs";

const draft = fs.readFileSync(
  "docs/rls-drafts/stripe-webhook-lease-compatibility.sql",
  "utf8",
);
const plan = fs.readFileSync(
  "docs/stripe-webhook-lease-compatibility-plan.md",
  "utf8",
);
const proof = fs.readFileSync(
  "scripts/stripe-webhook-lease-compatibility-postgres-proof.mjs",
  "utf8",
);
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));
const workflow = fs.readFileSync(".github/workflows/ci.yml", "utf8");

test("Stripe lease proof refuses persistent database targets", () => {
  assert.throws(
    () => parseStripeWebhookLeaseCompatibilityProofConfig({}),
    /is required/,
  );
  assert.throws(
    () => parseStripeWebhookLeaseCompatibilityProofConfig({
      STRIPE_WEBHOOK_LEASE_COMPATIBILITY_PROOF_DATABASE_URL:
        "postgresql://runtime:secret@production.example/grainline",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseStripeWebhookLeaseCompatibilityProofConfig({
      STRIPE_WEBHOOK_LEASE_COMPATIBILITY_PROOF_DATABASE_URL:
        "postgresql://runtime:secret@127.0.0.1/other",
    }),
    /requires the grainline_ci database/,
  );
});

test("Stripe lease draft is additive, rollback-only and production-gated", () => {
  assert.match(draft, /DRAFT ONLY/);
  assert.match(draft, /ADD COLUMN "claimGeneration" bigint NOT NULL DEFAULT 0/);
  assert.match(draft, /CHECK \("claimGeneration" >= 0\)/);
  assert.doesNotMatch(draft, /ENABLE ROW LEVEL SECURITY/);
  assert.doesNotMatch(draft, /FORCE ROW LEVEL SECURITY/);
  assert.doesNotMatch(draft, /REVOKE[\s\S]{0,80}ON TABLE/);
  assert.doesNotThrow(() => readStripeWebhookLeaseDraftBody());
  assert.match(plan, /not a Prisma migration/);
  assert.match(plan, /old ID-only finalizer retains the predecessor race/);
});

test("begin derives database time, locks duplicates and freezes event type", () => {
  assert.match(draft, /grainline_stripe_webhook_begin/);
  assert.equal(
    (draft.match(/clock_timestamp\(\) AT TIME ZONE 'UTC'/g) ?? []).length,
    3,
  );
  assert.match(draft, /FOR UPDATE/);
  assert.match(draft, /event type is immutable/);
  assert.ok(
    (draft.match(/char_length\(pg_catalog\.btrim\(p_event_id\)\) = 0/g) ?? []).length === 3,
  );
  assert.match(draft, /char_length\(pg_catalog\.btrim\(p_event_type\)\) = 0/);
  assert.match(draft, /"claimGeneration" = event\."claimGeneration" \+ 1/);
  assert.doesNotMatch(draft, /EXECUTE\s+[^;]*format\s*\(/i);
  assert.doesNotMatch(draft, /pg_catalog\.(?:coalesce|nullif|greatest|least)/i);
  assert.doesNotMatch(proof, /pg_catalog\.(?:coalesce|nullif|greatest|least)/i);
});

test("complete and fail bind the exact live generation", () => {
  for (const functionName of [
    "grainline_stripe_webhook_complete",
    "grainline_stripe_webhook_fail",
  ]) assert.match(draft, new RegExp(functionName));
  assert.ok(
    (draft.match(/event\."claimGeneration" = p_claim_generation/g) ?? []).length >= 2,
  );
  assert.ok(
    (draft.match(/event\."processingStartedAt" IS NOT NULL/g) ?? []).length >= 2,
  );
  assert.match(draft, /RETURN 'superseded'/);
  assert.match(draft, /pg_catalog\.left\([\s\S]*500/);
});

test("only the three reviewed function signatures are granted", () => {
  for (const signature of [
    "grainline_stripe_webhook_begin\\(text, text\\)",
    "grainline_stripe_webhook_complete\\(text, bigint\\)",
    "grainline_stripe_webhook_fail\\(text, bigint, text\\)",
  ]) {
    assert.match(draft, new RegExp(`REVOKE ALL ON FUNCTION public\\.${signature}`));
    assert.match(draft, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${signature}`));
  }
  assert.ok((draft.match(/SECURITY DEFINER/g) ?? []).length === 3);
  assert.ok((draft.match(/SET search_path = pg_catalog/g) ?? []).length === 3);
  assert.match(proof, /pg_catalog\.aclexplode/);
  assert.match(proof, /acl\.grantee = 0/);
  assert.match(proof, /procedure\.proowner = \(CURRENT_USER::pg_catalog\.regrole\)::oid/);
});

test("engine proof covers ABA rejection and exact rollback", () => {
  assert.match(proof, /callComplete\(client, ids\.fresh, "1"\), "superseded"/);
  assert.match(proof, /callFail\(client, ids\.fresh, "1"[\s\S]*"superseded"/);
  assert.match(proof, /claim_generation: "8"/);
  assert.match(proof, /error_length: 500/);
  assert.match(proof, /"blank_identity"/);
  assert.match(proof, /"blank_type"/);
  assert.match(proof, /SET LOCAL TIME ZONE 'America\/Chicago'/);
  assert.match(proof, /EXTRACT\(\s*epoch FROM \(pg_catalog\.clock_timestamp\(\) AT TIME ZONE 'UTC'\)/);
  assert.match(proof, /checks: 10/);
  assert.match(proof, /rolledBack: true/);
  assert.match(proof, /productionTouched: false/);
});

test("CI runs the exact rollback-only Stripe lease proof", () => {
  assert.equal(
    packageJson.scripts["audit:rls-stripe-webhook-lease-compatibility"],
    "node --test tests/postgres-special-form-qualification.test.mjs && node scripts/stripe-webhook-lease-compatibility-postgres-proof.mjs",
  );
  assert.match(
    workflow,
    /Prove compatible Stripe webhook leases in rollback-only PostgreSQL[\s\S]*npm run audit:rls-stripe-webhook-lease-compatibility[\s\S]*STRIPE_WEBHOOK_LEASE_COMPATIBILITY_PROOF_DATABASE_URL: \$\{\{ env\.DIRECT_URL \}\}/,
  );
});
