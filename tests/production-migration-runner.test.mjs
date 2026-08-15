import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { describe, it } from "node:test";
import {
  PRODUCTION_MIGRATION_CONFIRMATION,
  assertProductionMigrationDatabaseState,
  assertProductionMigrationGitState,
  parseProductionMigrationEnvironment,
  runProductionMigrationPreflight,
} from "../scripts/guard-production-migration-runner.mjs";
import {
  assertStripeWebhookEventForceProductionScope,
  parseStripeWebhookEventForceProductionScopeEnvironment,
  verifyStripeWebhookEventForceProductionScope,
} from "../scripts/verify-stripe-webhook-event-force-production-scope.mjs";

const COMMIT = "a".repeat(40);
const DIRECT_URL = "postgresql://neondb_owner:owner-password@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const DIRECT_URL_SHA256 = createHash("sha256").update(DIRECT_URL).digest("hex");

function environment(overrides = {}) {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: COMMIT,
    PRODUCTION_MIGRATION_RELEASE_COMMIT: COMMIT,
    PRODUCTION_MIGRATION_CONFIRM: PRODUCTION_MIGRATION_CONFIRMATION,
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: DIRECT_URL_SHA256,
    DIRECT_URL,
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    MIGRATION_DB_ROLE: "neondb_owner",
    ...overrides,
  };
}

function ownerRole() {
  return {
    rolname: "neondb_owner",
    rolsuper: false,
    rolcreatedb: true,
    rolcreaterole: true,
    rolinherit: true,
    rolcanlogin: true,
    rolreplication: true,
    rolbypassrls: true,
    memberships: [
      "grainline_app_runtime",
      "grainline_direct_upload_cleanup_v2",
      "neon_superuser",
    ],
    membership_options: [
      {
        role: "grainline_app_runtime",
        adminOption: true,
        inheritOption: false,
        setOption: false,
      },
      {
        role: "grainline_direct_upload_cleanup_v2",
        adminOption: true,
        inheritOption: false,
        setOption: false,
      },
      {
        role: "neon_superuser",
        adminOption: false,
        inheritOption: true,
        setOption: true,
      },
    ],
  };
}

function runtimeRole() {
  return {
    rolname: "grainline_app_runtime",
    rolsuper: false,
    rolcreatedb: false,
    rolcreaterole: false,
    rolinherit: false,
    rolcanlogin: true,
    rolreplication: false,
    rolbypassrls: false,
    memberships: [],
    membership_options: [],
  };
}

function databaseState() {
  return {
    identity: {
      database_name: "neondb",
      current_user_name: "neondb_owner",
      session_user_name: "neondb_owner",
    },
    ownerRole: ownerRole(),
    runtimeRole: runtimeRole(),
    savedSearch: {
      rls_enabled: true,
      rls_forced: true,
      owner_name: "neondb_owner",
      policy_count: 3,
    },
    incompleteMigrationCount: 0,
  };
}

describe("isolated production migration runner", () => {
  it("accepts only the exact manually dispatched main commit and direct owner target", () => {
    const parsed = parseProductionMigrationEnvironment(environment());
    assert.equal(parsed.releaseCommit, COMMIT);
    assert.equal(parsed.identity.username, "neondb_owner");
    assert.equal(parsed.identity.isPooler, false);
    assert.equal(parsed.identity.endpointId, "ep-plain-river-aaqg8gj4");
  });

  it("rejects non-main, non-manual, mismatched, pooled, and mixed-credential jobs", () => {
    const cases = [
      { GITHUB_REF: "refs/heads/feature" },
      { GITHUB_EVENT_NAME: "push" },
      { PRODUCTION_MIGRATION_RELEASE_COMMIT: "b".repeat(40) },
      { PRODUCTION_MIGRATION_CONFIRM: "yes" },
      { DIRECT_URL: DIRECT_URL.replace(".westus3", "-pooler.westus3") },
      { PRODUCTION_MIGRATION_DIRECT_URL_SHA256: "0".repeat(64) },
      { DATABASE_URL: "present" },
      { GRANT_AUDIT_DATABASE_URL: "present" },
    ];
    for (const drift of cases) {
      assert.throws(() => parseProductionMigrationEnvironment(environment(drift)));
    }
  });

  it("pins exact owner/runtime memberships, Phase B FORCE, and a clean migration ledger", () => {
    assert.deepEqual(assertProductionMigrationDatabaseState(databaseState()), {
      databaseName: "neondb",
      ownerRole: "neondb_owner",
      runtimeRole: "grainline_app_runtime",
      savedSearchRlsEnabled: true,
      savedSearchRlsForced: true,
      savedSearchPolicyCount: 3,
      incompleteMigrationCount: 0,
    });

    for (const mutate of [
      (state) => { state.savedSearch.rls_forced = false; },
      (state) => { state.incompleteMigrationCount = 1; },
      (state) => { state.ownerRole.membership_options[0].setOption = true; },
      (state) => { state.ownerRole.membership_options[1].inheritOption = true; },
      (state) => { state.runtimeRole.rolbypassrls = true; },
    ]) {
      const drifted = databaseState();
      mutate(drifted);
      assert.throws(() => assertProductionMigrationDatabaseState(drifted), /drifted/);
    }
  });

  it("requires an exact clean checkout before the database read", async () => {
    assert.deepEqual(assertProductionMigrationGitState({ head: COMMIT, status: "" }, COMMIT), {
      head: COMMIT,
      clean: true,
    });
    assert.throws(
      () => assertProductionMigrationGitState({ head: COMMIT, status: "?? migration.sql" }, COMMIT),
      /exact clean dispatched release commit/,
    );

    const calls = [];
    const result = await runProductionMigrationPreflight(
      parseProductionMigrationEnvironment(environment()),
      {
        readGitState: () => {
          calls.push("git");
          return { head: COMMIT, status: "" };
        },
        readDatabaseState: async (url) => {
          assert.equal(url, DIRECT_URL);
          calls.push("database");
          return databaseState();
        },
      },
    );
    assert.deepEqual(calls, ["git", "database"]);
    assert.equal(result.status, "passed");
    assert.doesNotMatch(JSON.stringify(result), /owner-password|DIRECT_URL/);
  });

  it("uses an environment-scoped secret and never runs migrations in Vercel builds", () => {
    const workflow = fs.readFileSync(".github/workflows/production-migrations.yml", "utf8");
    const vercel = JSON.parse(fs.readFileSync("vercel.json", "utf8"));
    const runtimeSource = fs.readFileSync("src/lib/db.ts", "utf8");

    assert.match(workflow, /^\s*workflow_dispatch:/m);
    assert.match(workflow, /^permissions:\s*\n\s+contents: read/m);
    assert.match(workflow, /^\s+environment: Production$/m);
    assert.match(workflow, /secrets\.PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.match(workflow, /vars\.PRODUCTION_MIGRATION_DIRECT_URL_SHA256/);
    assert.doesNotMatch(workflow, /secrets\.(?:DIRECT_URL|DATABASE_URL)\b/);
    assert.match(workflow, /cancel-in-progress: false/);
    assert.match(workflow, /guard-production-migration-runner\.mjs[\s\S]*prisma migrate deploy[\s\S]*prisma migrate status[\s\S]*audit:db-grants/);
    const jobEnvironment = workflow.slice(
      workflow.indexOf("    env:"),
      workflow.indexOf("    steps:"),
    );
    assert.doesNotMatch(jobEnvironment, /DIRECT_URL:\s*\$\{\{\s*secrets\./);
    assert.match(workflow, /Verify exact source[\s\S]*?env:\s*\n\s+DIRECT_URL: \$\{\{ secrets\.PRODUCTION_MIGRATION_DIRECT_URL \}\}/);
    const orderedSteps = [
      "Verify exact CheckoutStockReservation FORCE migration tree",
      "Verify exact CheckoutStockReservation FORCE release",
      "Isolate the reviewed CheckoutStockReservation FORCE release",
      "Verify exact CheckoutStockReservation activation migration tree",
      "Verify exact CheckoutStockReservation activation release",
      "Isolate the reviewed CheckoutStockReservation activation",
      "Verify exact CheckoutStockReservation source-consistency migration tree",
      "Verify exact CheckoutStockReservation source-consistency release",
      "Isolate the reviewed CheckoutStockReservation source-consistency successor",
      "Verify exact CheckoutStockReservation authority migration tree after isolation",
      "Verify sealed CheckoutStockReservation authority predecessor release",
      "Verify sealed StripeWebhookEvent FORCE predecessor",
      "Verify exact Case FORCE proof equivalence",
      "Verify DirectUpload activation proof equivalence",
      "Restore the reviewed CheckoutStockReservation source-consistency successor",
      "Restore the reviewed CheckoutStockReservation activation",
      "Restore the reviewed CheckoutStockReservation FORCE release",
      "Inspect exact CheckoutStockReservation FORCE restart scope read-only",
      "Generate Prisma client",
      "Apply production migrations",
      "Converge exact FORCE-hardened CheckoutStockReservation runtime grants",
      "Verify production migration status",
      "Audit final runtime grants and RLS catalog",
      "Prove exact CheckoutStockReservation FORCE production scope",
    ];
    const indexes = orderedSteps.map((step) => workflow.indexOf(step));
    assert.ok(indexes.every((index) => index >= 0));
    assert.deepEqual(indexes, [...indexes].sort((left, right) => left - right));
    assert.match(
      workflow,
      /SAVED_SEARCH_RLS_DEPLOY_PHASE: checkout-stock-reservation-activation-reviewed/u,
    );
    assert.match(
      workflow,
      /SAVED_SEARCH_RLS_DEPLOY_PHASE: checkout-stock-reservation-force-reviewed/u,
    );
    assert.match(
      workflow,
      /SAVED_SEARCH_RLS_DEPLOY_PHASE: checkout-stock-reservation-source-consistency-reviewed/u,
    );
    assert.match(
      workflow,
      /SAVED_SEARCH_RLS_DEPLOY_PHASE: checkout-stock-reservation-authority-reviewed/u,
    );
    assert.match(workflow, /20260815060001_force_checkout_stock_reservation_rls/u);
    assert.equal(vercel.buildCommand, "npm run guard:runtime-db-env && npm run build");
    assert.doesNotMatch(vercel.buildCommand, /migrat/i);
    assert.match(runtimeSource, /requiredProductionEnv\("DATABASE_URL"\)/);
    assert.doesNotMatch(runtimeSource, /DIRECT_URL|MIGRATION_DB_ROLE/);
  });

  it("attests one applied FORCE row and an absent reservation successor", async () => {
    const parsed = parseStripeWebhookEventForceProductionScopeEnvironment(
      environment(),
    );
    const acceptedRows = [{
      migration_name: "20260810172000_force_stripe_webhook_event_rls",
      finished_at: new Date("2026-08-13T00:00:00.000Z"),
      rolled_back_at: null,
      applied_steps_count: 1,
    }];
    assert.deepEqual(assertStripeWebhookEventForceProductionScope(acceptedRows), {
      forceMigration: "20260810172000_force_stripe_webhook_event_rls",
      forceApplied: true,
      successorMigration:
        "20260810190000_prepare_checkout_stock_reservation_authority",
      successorRows: 0,
      productionChangedByProof: false,
    });
    const result = await verifyStripeWebhookEventForceProductionScope(parsed, {
      readRows: async (url) => {
        assert.equal(url, DIRECT_URL);
        return acceptedRows;
      },
    });
    assert.equal(result.forceApplied, true);
    assert.doesNotMatch(JSON.stringify(result), /owner-password|DIRECT_URL/);

    for (const rows of [
      [],
      [{ ...acceptedRows[0], finished_at: null }],
      [{ ...acceptedRows[0], finished_at: undefined }],
      [{ ...acceptedRows[0], rolled_back_at: new Date() }],
      [{ ...acceptedRows[0], applied_steps_count: 0 }],
      [...acceptedRows, {
        migration_name:
          "20260810190000_prepare_checkout_stock_reservation_authority",
        finished_at: new Date(),
        rolled_back_at: null,
        applied_steps_count: 1,
      }],
    ]) {
      assert.throws(
        () => assertStripeWebhookEventForceProductionScope(rows),
        /FORCE-only scope/,
      );
    }

    for (const drift of [
      { GITHUB_ACTIONS: "false" },
      { GITHUB_EVENT_NAME: "push" },
      { GITHUB_REF: "refs/heads/feature" },
      { DIRECT_URL: DIRECT_URL.replace(".westus3", "-pooler.westus3") },
      { DIRECT_URL: DIRECT_URL.replace("neondb_owner", "grainline_app_runtime") },
    ]) {
      assert.throws(
        () => parseStripeWebhookEventForceProductionScopeEnvironment(
          environment(drift),
        ),
      );
    }

    const scopeSource = fs.readFileSync(
      "scripts/verify-stripe-webhook-event-force-production-scope.mjs",
      "utf8",
    );
    assert.match(scopeSource, /BEGIN TRANSACTION READ ONLY/);
    assert.match(scopeSource, /transaction_read_only/);
    assert.match(scopeSource, /ROLLBACK/);
    assert.doesNotMatch(scopeSource, /\b(?:insert|update|delete|truncate)\b/i);
  });
});
