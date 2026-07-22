import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS,
  PROVIDER_BYPASS_STATE_PATH,
  PROVIDER_ENVIRONMENT_KEYS,
  PROVIDER_ENVIRONMENT_VALUES,
  PROVIDER_PROOF_BRANCH,
  PROVIDER_PROOF_STATE_PATH,
  REVIEWED_NOTIFICATION_MIGRATIONS,
  REVIEWED_PRODUCTION_BRANCH_ID,
  REVIEWED_STAGING_BRANCH_ID,
  buildStagingDatabaseUrl,
  parseLastJsonObject,
  providerEnvironmentEntries,
  validateDatabaseUrl,
} from "../scripts/notification-provider-proof-operator.mjs";

const RUNTIME_PASSWORD = "a".repeat(64);
const OWNER_PASSWORD = "b".repeat(16);

describe("disposable Notification provider proof operator", () => {
  it("parses only the final JSON object from noisy local preflight output", () => {
    assert.deepEqual(
      parseLastJsonObject('prisma diagnostic\n{"status":"passed","metricErrorCount":0}\n'),
      {
        lineCount: 2,
        payload: { status: "passed", metricErrorCount: 0 },
      },
    );
    assert.throws(() => parseLastJsonObject("diagnostic only\n"));
    assert.throws(() => parseLastJsonObject('{"status":"passed"}\ntrailing noise\n'));
  });

  it("builds only the exact reviewed staging database identities", () => {
    assert.notEqual(REVIEWED_STAGING_BRANCH_ID, REVIEWED_PRODUCTION_BRANCH_ID);
    const runtime = buildStagingDatabaseUrl("grainline_app_runtime", RUNTIME_PASSWORD, {
      pooled: true,
    });
    const owner = buildStagingDatabaseUrl("neondb_owner", OWNER_PASSWORD, {
      pooled: false,
    });

    assert.equal(
      new URL(runtime).hostname,
      "ep-empty-union-aajlf1x0-pooler.westus3.azure.neon.tech",
    );
    assert.equal(new URL(owner).hostname, "ep-empty-union-aajlf1x0.westus3.azure.neon.tech");
    assert.equal(new URL(runtime).port, "5432");
    assert.equal(new URL(runtime).pathname, "/neondb");
    assert.equal(new URL(runtime).searchParams.get("sslmode"), "verify-full");
    assert.equal(new URL(runtime).searchParams.get("channel_binding"), "require");
    assert.equal(
      validateDatabaseUrl(runtime, { pooled: true, role: "grainline_app_runtime" }),
      runtime,
    );
    assert.throws(() => validateDatabaseUrl(
      runtime.replace("ep-empty-union-aajlf1x0", "ep-plain-river-aaqg8gj4"),
      { pooled: true, role: "grainline_app_runtime" },
    ));
  });

  it("pins the exact branch-scoped Preview variables with no owner authority", () => {
    const runtimeDatabaseUrl = buildStagingDatabaseUrl(
      "grainline_app_runtime",
      RUNTIME_PASSWORD,
      { pooled: true },
    );
    const entries = providerEnvironmentEntries({
      commitSha: "a".repeat(40),
      runId: `notification-b-${"c".repeat(36)}`,
      runtimeDatabaseUrl,
      triggerSecret: "d".repeat(64),
    });

    assert.equal(entries.length, 28);
    assert.deepEqual(entries.map((entry) => entry.key), PROVIDER_ENVIRONMENT_KEYS);
    assert.equal(new Set(entries.map((entry) => entry.key)).size, 28);
    assert.equal(entries.every((entry) => entry.gitBranch === PROVIDER_PROOF_BRANCH), true);
    assert.equal(entries.every((entry) => entry.type === "sensitive"), true);
    assert.equal(entries.every((entry) => JSON.stringify(entry.target) === '["preview"]'), true);
    assert.equal(
      entries.find((entry) => entry.key === "DATABASE_URL").value,
      entries.find((entry) => entry.key === "RLS_CONTEXT_GATE_DATABASE_URL").value,
    );
    assert.deepEqual(
      entries.map((entry) => entry.key).filter((key) => FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(key)),
      [],
    );
    assert.equal(PROVIDER_ENVIRONMENT_VALUES.NOTIFICATION_RLS_PROVIDER_REQUESTS, "120");
    assert.equal(PROVIDER_ENVIRONMENT_VALUES.NOTIFICATION_RLS_PROVIDER_WARMUP_REQUESTS, "12");
    assert.equal(PROVIDER_ENVIRONMENT_VALUES.RLS_CONTEXT_GATE_POOL_SIZE, "16");
  });

  it("keeps cleanup exact, production-excluding, and secret-state deleting", () => {
    const source = readFileSync("scripts/notification-provider-proof-operator.mjs", "utf8");

    assert.match(source, /REVIEWED_STAGING_BRANCH_ID === REVIEWED_PRODUCTION_BRANCH_ID/);
    assert.match(source, /deployment\.id === REVIEWED_PRODUCTION_DEPLOYMENT_ID/);
    assert.match(source, /NOTIFICATION_PROVIDER_PROOF_CLEANUP_CONFIRM/);
    assert.match(source, /delete-disposable-preview-and-staging/);
    assert.match(source, /delete-failed-disposable-preview-and-staging/);
    assert.match(source, /ownerOnlyFixtureTeardownPassed/);
    assert.match(source, /teardownNotificationProviderFixtures/);
    assert.match(source, /Notification provider fixtures remained after owner teardown/);
    assert.match(source, /branchEnvironmentVariablesDeleted/);
    assert.match(source, /bootstrapBypassState/);
    assert.match(source, /existing-sole-active-automation-bypass/);
    assert.match(source, /createBypassState/);
    assert.match(source, /generated-sole-active-automation-bypass/);
    assert.match(source, /body: \{ generate: \{\} \}/);
    assert.match(source, /requires zero automation bypass secrets before generation/);
    assert.match(source, /active\.length !== 1 \|\| active\[0\] !== bypassState\.bypassSecret/);
    assert.match(source, /revokeProviderBypass/);
    assert.match(source, /remainingAutomationBypassSecrets: 0/);
    assert.match(source, /regenerate: false/);
    assert.match(source, /rebindPredeploymentCommit/);
    assert.match(source, /preparedCommitSha: state\.commitSha/);
    assert.match(source, /provider deployment exists before commit rebinding/);
    assert.match(source, /rebindConfiguredCommit/);
    assert.match(source, /provider deployment exists before configured commit rebinding/);
    assert.match(source, /branch environment IDs drifted before configured commit rebinding/);
    assert.match(source, /RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA/);
    assert.match(source, /priorDeploymentCommitSha/);
    assert.match(source, /databasePreparationCommitSha/);
    assert.match(source, /\^\[A-Za-z0-9_-\]\{8,128\}\$/);
    assert.doesNotMatch(source, /\^env_/);
    assert.match(source, /\^v24\\\./);
    assert.match(source, /configuredNodeVersion/);
    assert.match(source, /unlinkSync\(PROVIDER_PROOF_STATE_PATH\)/);
    assert.match(source, /unlinkSync\(PROVIDER_BYPASS_STATE_PATH\)/);
    assert.equal(PROVIDER_PROOF_STATE_PATH.startsWith("/private/tmp/"), true);
    assert.equal(PROVIDER_BYPASS_STATE_PATH.startsWith("/private/tmp/"), true);
    assert.doesNotMatch(source, /console\.log\([^\n]*(?:triggerSecret|runtimeDatabaseUrl|adminDatabaseUrl|bypassSecret)/);
  });

  it("applies only the byte-pinned split migrations before seeding real fixtures", () => {
    const source = readFileSync("scripts/notification-provider-proof-operator.mjs", "utf8");
    assert.equal(
      REVIEWED_NOTIFICATION_MIGRATIONS.preparation.sha256,
      "83f49cec2589c359cda5413282a492f68b26cca760f54861cd29a9a3bfb579f9",
    );
    assert.equal(
      REVIEWED_NOTIFICATION_MIGRATIONS.activation.sha256,
      "e40994886a143101141c7114ed8ea2f92917ccdd349fe96a0874a2cb79561329",
    );
    const stage = source.indexOf("stageReviewedCandidateMigrations()");
    const deploy = source.indexOf("runReviewedPrismaMigrationDeploy(adminDatabaseUrl)");
    const audit = source.indexOf("runReviewedRuntimeGrantAudit(adminDatabaseUrl)");
    const remove = source.indexOf("removeStagedCandidateMigrations()", audit);
    const seed = source.indexOf("await seedNotificationProviderFixtures(adminDatabaseUrl)");
    const ledger = source.indexOf('runOwnerOnlyGate(state, "prepare")');
    assert.ok(
      stage >= 0
      && stage < deploy
      && deploy < audit
      && audit < remove
      && remove < seed
      && seed < ledger,
    );
    assert.match(source, /fixtureCount\.rows\[0\]\.count !== 10/);
    assert.match(source, /\$1::text[\s\S]{0,180}'message', \$1::text/);
    assert.match(source, /\$5::text[\s\S]{0,180}'account_warning', \$5::text/);
    assert.match(source, /Provider message body', \$8::text/);
    assert.match(source, /Provider foreign body'[\s\S]{0,180}\$15::text/);
    assert.doesNotMatch(source, /\$1[67]::text/);
    assert.match(source, /relrowsecurity !== true/);
    assert.match(source, /relforcerowsecurity !== false/);
    assert.match(source, /REVIEWED_PRISMA_CLI_VERSION = "7\.9\.0"/);
    assert.match(source, /--package=prisma@\$\{REVIEWED_PRISMA_CLI_VERSION\}/);
    assert.match(source, /locked Prisma CLI version drifted/);
    assert.match(source, /REVIEWED_TSX_VERSION = "4\.21\.0"/);
    assert.match(source, /localPreflight/);
    assert.match(source, /!state\.localPreflightAt/);
    assert.match(source, /notification-provider-local-preflight\.ts/);
    assert.match(source, /teardownNotificationProviderFixtures\(state\.adminDatabaseUrl\)/);
    assert.match(source, /seedNotificationProviderFixtures\(state\.adminDatabaseUrl\)/);
    assert.match(source, /local Notification provider preflight failed after fixture reset/);
    assert.match(source, /both bounded local preflight evidence attempts already exist/);
    assert.match(source, /rebindLocalPreflightRetryCommit/);
    assert.match(source, /one bounded local-preflight retry rebind/);
    assert.match(source, /provider branch environment must remain empty before local-preflight retry/);
    assert.match(source, /provider deployment exists before local-preflight retry/);
    assert.match(source, /priorLocalPreflightCommitSha/);
    assert.match(source, /localPreflightRetry: 2/);
  });
});
