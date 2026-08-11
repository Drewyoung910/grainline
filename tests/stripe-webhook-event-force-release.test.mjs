import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  parseStripeWebhookEventForceProofConfig,
} from "../scripts/stripe-webhook-event-force-postgres-proof.mjs";
import {
  STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_CONFIRMATION,
  parseStripeWebhookEventForcePostflightConfig,
  writeStripeWebhookEventForcePostflightEvidence,
} from "../scripts/stripe-webhook-event-force-production-postflight.mjs";
import {
  parseStripeWebhookEventForceRollbackProofConfig,
} from "../scripts/stripe-webhook-event-force-rollback-proof.mjs";
import {
  STRIPE_WEBHOOK_EVENT_FORCE_DRAFT_SHA256,
  buildStripeWebhookEventForceCandidate,
} from "../scripts/stage-stripe-webhook-event-force-migration.mjs";
import {
  STRIPE_WEBHOOK_EVENT_FORCE_RELEASE_PHASE,
  verifyStripeWebhookEventForceRelease,
} from "../scripts/verify-stripe-webhook-event-force-release.mjs";

const migration = fs.readFileSync(
  "prisma/migrations/20260810172000_force_stripe_webhook_event_rls/migration.sql",
  "utf8",
);
const rollback = fs.readFileSync(
  "docs/rls-drafts/stripe-webhook-event-force-rollback.sql",
  "utf8",
);
const ci = fs.readFileSync(".github/workflows/ci.yml", "utf8");
const production = fs.readFileSync(
  ".github/workflows/production-migrations.yml",
  "utf8",
);
const releaseDocument = fs.readFileSync(
  "docs/stripe-webhook-event-force-release.md",
  "utf8",
);
const postgresProof = fs.readFileSync(
  "scripts/stripe-webhook-event-force-postgres-proof.mjs",
  "utf8",
);
const rollbackProof = fs.readFileSync(
  "scripts/stripe-webhook-event-force-rollback-proof.mjs",
  "utf8",
);
const runbook = fs.readFileSync("docs/runbook.md", "utf8");
const launchChecklist = fs.readFileSync("docs/launch-checklist.md", "utf8");
const RELEASE_COMMIT = "a".repeat(40);
const RUNTIME_URL =
  "postgresql://grainline_app_runtime:runtime@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function postflightEnvironment(directory) {
  return {
    DATABASE_URL: RUNTIME_URL,
    STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_CONFIRM:
      STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_CONFIRMATION,
    STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_EVIDENCE_PATH: path.join(
      directory,
      `stripe-webhook-event-force-production-postflight-${RELEASE_COMMIT}.json`,
    ),
    STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID: "31234567890",
    STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_MIGRATION_RUN_ID: "31234567891",
    STRIPE_WEBHOOK_EVENT_FORCE_POSTFLIGHT_RELEASE_COMMIT: RELEASE_COMMIT,
  };
}

test("FORCE release is one byte-pinned posture-only catalog change", () => {
  const candidate = buildStripeWebhookEventForceCandidate();
  const release = verifyStripeWebhookEventForceRelease(undefined, {
    allowReviewedSuccessor: true,
  });
  assert.equal(release.phase, STRIPE_WEBHOOK_EVENT_FORCE_RELEASE_PHASE);
  assert.equal(release.forceDraftSha256, STRIPE_WEBHOOK_EVENT_FORCE_DRAFT_SHA256);
  assert.equal(release.forceMigrationSha256, candidate.migrationSha256);
  assert.equal(release.protectedTables, 1);
  assert.equal(release.runtimeFunctions, 6);
  assert.equal(release.rlsEnabled, true);
  assert.equal(release.rlsForced, true);
  assert.equal(release.policyCount, 0);
  assert.equal(release.runtimeTablePrivileges, 0);
  assert.equal(release.rowDataChanged, false);
  assert.equal(release.guard.sealedPrefix, true);
  assert.equal(
    release.guard.successorPhase,
    "case-resolution-window-reviewed",
  );
  assert.equal(
    (migration.match(
      /^ALTER TABLE public\."StripeWebhookEvent" FORCE ROW LEVEL SECURITY;$/gm,
    ) ?? []).length,
    1,
  );
  assert.doesNotMatch(migration, /\bNO\s+FORCE\b/i);
  assert.doesNotMatch(migration, /\bCREATE\s+POLICY\b/i);
  assert.doesNotMatch(migration, /^\s*(?:GRANT|REVOKE)\b/im);
  assert.doesNotMatch(
    migration,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
  );
  assert.doesNotMatch(
    migration,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
  );
});

test("FORCE preflight pins the exact Phase-A table, role graph, owner and functions", () => {
  assert.match(migration, /runtime role retains unreviewed role membership/);
  assert.match(migration, /member\.rolname = 'neondb_owner'/);
  assert.match(migration, /grantor\.rolname = 'cloud_admin'/);
  assert.match(migration, /NOT membership\.inherit_option/);
  assert.match(migration, /NOT membership\.set_option/);
  assert.match(migration, /WITH RECURSIVE restricted_members/);
  assert.match(migration, /owner-session drain is incomplete/);
  assert.match(migration, /class\.relrowsecurity/);
  assert.match(migration, /NOT class\.relforcerowsecurity/);
  assert.match(migration, /IF accepted_table_count <> 1/);
  assert.match(migration, /oidvectortypes\(procedure\.proargtypes\)/);
  assert.match(migration, /pg_catalog\.md5\(procedure\.prosrc\)/);
  assert.match(migration, /IF accepted_function_count <> 6/);
  assert.match(migration, /IF named_runtime_function_count <> 6/);
  assert.match(migration, /IF table_function_count <> 6/);
  assert.doesNotMatch(
    migration,
    /pg_catalog\.(?:coalesce|nullif|greatest|least)\b/i,
  );
});

test("FORCE rollback restores only Phase A and is restart-safe in proof", () => {
  assert.match(
    rollback,
    /ALTER TABLE public\."StripeWebhookEvent" NO FORCE ROW LEVEL SECURITY/,
  );
  assert.match(rollback, /rollback predecessor drifted/);
  assert.match(rollback, /did not restore Phase A/);
  assert.doesNotMatch(rollback, /\b(?:GRANT|REVOKE)\b/i);
  assert.doesNotMatch(rollback, /\b(?:ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i);
  assert.doesNotMatch(
    rollback,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
  );
  const proof = fs.readFileSync(
    "scripts/stripe-webhook-event-force-rollback-proof.mjs",
    "utf8",
  );
  assert.match(proof, /finally \{/);
  assert.match(proof, /FORCE ROW LEVEL SECURITY/);
  assert.match(proof, /forceRestored: true/);
});

test("disposable FORCE and rollback proofs are loopback-only", () => {
  assert.throws(() => parseStripeWebhookEventForceProofConfig({}), /is required/);
  assert.throws(
    () => parseStripeWebhookEventForceProofConfig({
      STRIPE_WEBHOOK_EVENT_FORCE_PROOF_DATABASE_URL:
        "postgresql://ci:secret@production.example/grainline",
    }),
    /refuses a non-loopback database/,
  );
  assert.throws(
    () => parseStripeWebhookEventForceRollbackProofConfig({}),
    /is required/,
  );
  assert.throws(
    () => parseStripeWebhookEventForceRollbackProofConfig({
      STRIPE_WEBHOOK_EVENT_FORCE_ROLLBACK_PROOF_DATABASE_URL:
        "postgresql://ci:secret@production.example/grainline",
    }),
    /refuses a non-loopback database/,
  );
});

test("production FORCE postflight accepts only pooled runtime and fresh evidence", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stripe-force-"));
  const parsed = parseStripeWebhookEventForcePostflightConfig(
    postflightEnvironment(directory),
  );
  assert.equal(parsed.releaseCommit, RELEASE_COMMIT);
  assert.equal(parsed.runtimeIdentity.runtimeRole, "grainline_app_runtime");
  assert.equal(parsed.runtimeIdentity.endpointId, "ep-plain-river-aaqg8gj4");
  assert.throws(
    () => parseStripeWebhookEventForcePostflightConfig({
      ...postflightEnvironment(directory),
      DIRECT_URL: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner"),
    }),
    /privileged database keys/,
  );
  assert.throws(
    () => parseStripeWebhookEventForcePostflightConfig({
      ...postflightEnvironment(directory),
      DATABASE_URL: RUNTIME_URL.replace("-pooler", ""),
    }),
    /pooled Neon endpoint/,
  );
  const evidencePath = path.join(directory, "force-evidence.json");
  writeStripeWebhookEventForcePostflightEvidence(evidencePath, {
    status: "passed",
    productionChangedByPostflight: false,
  });
  assert.equal(fs.statSync(evidencePath).mode & 0o777, 0o600);
  assert.throws(
    () => writeStripeWebhookEventForcePostflightEvidence(evidencePath, {}),
    /EEXIST/,
  );
});

test("CI and production workflows isolate and prove FORCE after Phase A", () => {
  const pkg = JSON.parse(fs.readFileSync("package.json", "utf8"));
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-event-force-release"],
    "node scripts/verify-stripe-webhook-event-force-release.mjs",
  );
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-event-force-sealed-prefix"],
    "node scripts/verify-stripe-webhook-event-force-release.mjs --allow-reviewed-successor",
  );
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-event-force-postgres"],
    "node --test tests/postgres-special-form-qualification.test.mjs && node scripts/stripe-webhook-event-force-postgres-proof.mjs",
  );
  assert.equal(
    pkg.scripts["audit:rls-stripe-webhook-event-force-rollback"],
    "node scripts/stripe-webhook-event-force-rollback-proof.mjs",
  );
  assert.equal(
    pkg.scripts["ops:stripe-webhook-event-force-postflight"],
    "node scripts/stripe-webhook-event-force-production-postflight.mjs",
  );
  assert.match(
    postgresProof,
    /verifyStripeWebhookEventForceRelease\(undefined, \{\s*allowReviewedSuccessor: true/,
  );
  assert.match(
    rollbackProof,
    /verifyStripeWebhookEventForceRelease\(undefined, \{\s*allowReviewedSuccessor: true/,
  );
  const forceIsolate = ci.indexOf(
    "Isolate the exact StripeWebhookEvent FORCE release",
  );
  const sealedPhaseA = ci.indexOf(
    "audit:rls-stripe-webhook-event-activation-sealed-prefix",
  );
  const phaseARestore = ci.indexOf(
    "Restore the exact StripeWebhookEvent activation release",
  );
  const forceRestore = ci.indexOf(
    "Restore the exact StripeWebhookEvent FORCE release",
  );
  const forceProof = ci.indexOf(
    "Prove FORCE-hardened StripeWebhookEvent authority",
  );
  assert.ok(sealedPhaseA >= 0 && sealedPhaseA < forceIsolate);
  assert.ok(forceIsolate >= 0 && forceIsolate < phaseARestore);
  assert.ok(forceRestore > phaseARestore && forceProof > forceRestore);
  assert.match(
    ci,
    /Audit FORCE-hardened StripeWebhookEvent grants and RLS catalog[\s\S]*Restore CheckoutStockReservation authority for sealed FORCE proofs[\s\S]*20260810190000_prepare_checkout_stock_reservation_authority[\s\S]*Prove FORCE-hardened StripeWebhookEvent authority[\s\S]*Re-audit restored StripeWebhookEvent FORCE posture[\s\S]*Apply CheckoutStockReservation compatible authority/,
  );
  assert.match(ci, /checkout-stock-reservation-authority-reviewed/);
  assert.match(ci, /audit:rls-stripe-webhook-event-force-sealed-prefix/);
  assert.match(production, /case-resolution-window-reviewed/);
  assert.ok(
    production.indexOf("audit:rls-stripe-webhook-event-force-sealed-prefix")
      < production.indexOf("npx prisma migrate deploy"),
  );
  assert.match(
    production,
    /Isolate queued StripeWebhookEvent FORCE from this Case-only release[\s\S]*20260810172000_force_stripe_webhook_event_rls[\s\S]*Apply production migrations/,
  );
  assert.match(
    releaseDocument,
    /Status: the reviewed FORCE preparation is merged but not applied/,
  );
  assert.doesNotMatch(releaseDocument, /Status: isolated candidate only/);
  assert.match(
    releaseDocument,
    /b8a9f41b9f5ca966f02901fb322ba9775210fd80/,
  );
  assert.match(
    releaseDocument,
    /6d448bce38bed2aa54bf4ce7ae8e5f8a4ba73186/,
  );
  assert.match(releaseDocument, /exact-main CI `31419148169` passed/);
  assert.match(
    releaseDocument,
    /merge and exact-main CI do not authorize or imply production FORCE/,
  );
  assert.match(releaseDocument, /exact main\s+`f987645784a447604fcab2399dc8e7fd7bef9d7c`/);
  assert.match(releaseDocument, /Migrations run `31410550315`/);
  assert.match(releaseDocument, /durable ownership-drift invariant/);
  assert.match(releaseDocument, /Connect v2 signed delivery/);
  assert.match(releaseDocument, /31415661672/);
  assert.match(releaseDocument, /before any Prisma deploy or PostgreSQL proof/);
  assert.match(releaseDocument, /exact reviewed FORCE successor guard/);
  assert.match(runbook, /StripeWebhookEvent FORCE postflight:/);
  assert.match(launchChecklist, /ops:stripe-webhook-event-force-postflight/);
});
