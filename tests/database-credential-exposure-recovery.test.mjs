import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  DEPLOYED_SOURCE_COMMIT,
  FORCE_MAIN_CI_RUN_ID,
  FORCE_MIGRATION_RUN_ID,
  FORCE_RELEASE_COMMIT,
  PRIOR_DEPLOYMENT_ID,
  RECOVERY_CONFIRMATION,
  classifyCredentialProbe,
  freshRecoveryState,
  normalizeCandidateDeployment,
  normalizeGithubRun,
  normalizePriorDeployment,
  normalizeRecoveryVercelState,
  normalizeReplacementDeploymentInventory,
  recoveryDeploymentMarker,
  parseRecoveryConfig,
  assertRecoveryReleaseGitState,
  validateForcePostflightEvidence,
  validateRecoveryEvidence,
  validateRecoveryState,
} from "../scripts/database-credential-exposure-recovery.mjs";
import {
  REVIEWED_NEON_CLI_INTEGRITY,
  REVIEWED_NEON_CLI_PATH,
  validateNeonRuntimeResetResponse,
} from "../scripts/neon-owner-password-control.mjs";

const RUNTIME_URL =
  "postgresql://grainline_app_runtime:abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const OWNER_URL =
  "postgresql://neondb_owner:AbCdEfGhIjKlMn_1@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";

function configEnvironment(commit = "a".repeat(40)) {
  return {
    DATABASE_CREDENTIAL_RECOVERY_CONFIRM: RECOVERY_CONFIRMATION,
    DATABASE_CREDENTIAL_RECOVERY_OPERATOR_COMMIT: commit,
    DATABASE_CREDENTIAL_RECOVERY_OPERATOR_CI_RUN_ID: "31729999999",
  };
}

test("recovery config is exact-commit sealed and rejects ambient database credentials", () => {
  assert.equal(parseRecoveryConfig(configEnvironment()).operatorCommit, "a".repeat(40));
  assert.throws(() => parseRecoveryConfig(configEnvironment("short")), /invalid/);
  assert.throws(
    () => parseRecoveryConfig({ ...configEnvironment(), DATABASE_URL: RUNTIME_URL }),
    /rejects ambient PostgreSQL credentials/,
  );
});

test("release commit is a one-file child that pins the implementation source hash", () => {
  const operatorSource = fs.readFileSync(
    "scripts/database-credential-exposure-recovery.mjs",
    "utf8",
  );
  const hash = createHash("sha256")
    .update(operatorSource)
    .digest("hex");
  const manifest = {
    implementationCommit: "b".repeat(40),
    operatorSourceSha256: hash,
  };
  assert.equal(assertRecoveryReleaseGitState({
    head: "a".repeat(40),
    parents: ["b".repeat(40)],
    changedPaths: ["docs/database-credential-recovery-release.json"],
    status: "",
  }, { operatorCommit: "a".repeat(40) }, manifest, operatorSource).clean, true);
  assert.throws(() => assertRecoveryReleaseGitState({
    head: "a".repeat(40),
    parents: ["c".repeat(40)],
    changedPaths: ["docs/database-credential-recovery-release.json"],
    status: "",
  }, { operatorCommit: "a".repeat(40) }, manifest, operatorSource));
});

test("runtime reset response is pinned to the reviewed role, target, password and operations", () => {
  const password = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
  const payload = {
    role: {
      branch_id: "br-hidden-mouse-aaugn2wr",
      name: "grainline_app_runtime",
      authentication_method: "password",
      updated_at: "2026-08-13T17:00:00Z",
      password,
    },
    operations: [{
      id: "operation-1234",
      project_id: "icy-unit-96812898",
      branch_id: "br-hidden-mouse-aaugn2wr",
      action: "reset_password",
      status: "running",
    }],
  };
  assert.equal(validateNeonRuntimeResetResponse(payload).password, password);
  assert.equal(validateNeonRuntimeResetResponse({
    ...payload,
    role: { ...payload.role, password: "AbCdEfGhIjKlMn_1" },
  }).password, "AbCdEfGhIjKlMn_1");
  assert.throws(() => validateNeonRuntimeResetResponse({
    ...payload,
    role: { ...payload.role, name: "neondb_owner" },
  }));
  assert.throws(() => validateNeonRuntimeResetResponse({
    ...payload,
    role: { ...payload.role, password: "too-short" },
  }));
});

test("private restart state accepts only reviewed database identities and monotonic stages", () => {
  const state = freshRecoveryState(RUNTIME_URL, OWNER_URL);
  assert.equal(validateRecoveryState(state).stage, "preflight");
  assert.throws(() => validateRecoveryState({
    ...state,
    priorRuntimeUrl: RUNTIME_URL.replace("grainline_app_runtime", "neondb_owner"),
  }));
  assert.throws(() => validateRecoveryState({ ...state, stage: "unknown" }));
  assert.throws(() => validateRecoveryState({
    ...state,
    stage: "runtime-reset-finished",
  }), /runtime credential/);
  const runtimeFinished = {
    ...state,
    stage: "runtime-reset-finished",
    nextRuntimeUrl: RUNTIME_URL.replace(
      "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
      "123456789_abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
    ),
    runtimeRoleUpdatedAtBefore: "2026-08-13T17:00:00.000Z",
    runtimeRoleUpdatedAtAfter: "2026-08-13T17:00:01.000Z",
  };
  assert.equal(validateRecoveryState(runtimeFinished).stage, "runtime-reset-finished");
  assert.throws(() => validateRecoveryState({
    ...runtimeFinished,
    stage: "runtime-deployment-ready",
  }), /replacement deployment/);
});

test("deployment boundaries pin the prior production and exact-source replacement", () => {
  const recoveryCreatedAt = "2026-08-13T17:00:00.000Z";
  const prior = normalizePriorDeployment({
    id: PRIOR_DEPLOYMENT_ID,
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    readyState: "READY",
    target: "production",
    source: "cli",
    source: "cli",
    url: "grainline-luhwmzddm-drew-youngs-projects.vercel.app",
    alias: ["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app"],
    meta: { gitCommitSha: DEPLOYED_SOURCE_COMMIT, gitCommitRef: "HEAD" },
  });
  assert.equal(prior.sourceCommit, DEPLOYED_SOURCE_COMMIT);
  const candidate = normalizeCandidateDeployment({
    id: "dpl_Replacement123",
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    readyState: "READY",
    target: "production",
    source: "cli",
    url: "grainline-replacement.vercel.app",
    meta: {
      gitCommitSha: DEPLOYED_SOURCE_COMMIT,
      gitCommitRef: "HEAD",
      grainlineCredentialRecovery: recoveryDeploymentMarker(recoveryCreatedAt),
    },
  }, recoveryCreatedAt);
  assert.equal(candidate.id, "dpl_Replacement123");
  assert.throws(() => normalizeCandidateDeployment({
    id: "dpl_Replacement123",
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    readyState: "READY",
    target: "production",
    url: "grainline-replacement.vercel.app",
    meta: { gitCommitSha: FORCE_RELEASE_COMMIT, gitCommitRef: "HEAD" },
  }, recoveryCreatedAt));
});

test("recovery Vercel inventory tolerates credential timestamp changes but no authority drift", () => {
  const project = {
    envs: [
      { key: "DATABASE_URL", type: "sensitive", target: ["production"], gitBranch: null, updatedAt: 1 },
      { key: "RUNTIME_DB_ROLE", type: "sensitive", target: ["production"], gitBranch: null, updatedAt: 2 },
    ],
  };
  const shared = { data: [], pagination: { count: 0, next: null } };
  assert.equal(normalizeRecoveryVercelState(project, shared).stage, "runtime-only");
  assert.equal(normalizeRecoveryVercelState({
    envs: project.envs.map((entry) => ({ ...entry, updatedAt: entry.updatedAt + 100 })),
  }, shared).stage, "runtime-only");
  assert.throws(() => normalizeRecoveryVercelState({
    envs: [...project.envs, {
      key: "DIRECT_URL", type: "sensitive", target: ["production"], gitBranch: null,
    }],
  }, shared), /privileged/);
  assert.throws(() => normalizeRecoveryVercelState(project, {
    data: [{ key: "DATABASE_URL", projectId: ["prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp"] }],
    pagination: { count: 1, next: null },
  }), /shared/);
});

test("replacement deployment inventory recovers exactly one lost CLI response", () => {
  const createdAt = "2026-08-13T17:00:00.000Z";
  const deployment = {
    id: "dpl_Replacement123",
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    target: "production",
    meta: {
      gitCommitSha: DEPLOYED_SOURCE_COMMIT,
      gitCommitRef: "HEAD",
      grainlineCredentialRecovery: recoveryDeploymentMarker(createdAt),
    },
    createdAt: Date.parse(createdAt) + 1,
  };
  assert.deepEqual(normalizeReplacementDeploymentInventory({
    deployments: [deployment],
    pagination: { count: 1, next: null },
  }, createdAt), ["dpl_Replacement123"]);
  assert.deepEqual(normalizeReplacementDeploymentInventory({
    deployments: [{ ...deployment, createdAt: Date.parse(createdAt) - 1 }],
    pagination: { count: 1, next: null },
  }, createdAt), []);
  assert.throws(() => normalizeReplacementDeploymentInventory({
    deployments: [deployment, { ...deployment, id: "dpl_Replacement456" }],
    pagination: { count: 2, next: null },
  }, createdAt), /ambiguous/);
  assert.throws(() => normalizeReplacementDeploymentInventory({
    deployments: Array.from({ length: 100 }, (_, index) => ({
      ...deployment,
      id: `dpl_Replacement${index}`,
    })),
    pagination: { count: 100, next: 1 },
  }, createdAt), /incomplete/);
});

test("restart evidence validators accept only the exact completed proofs", () => {
  const config = {
    operatorCommit: "a".repeat(40),
    operatorCiRunId: 31729999999,
  };
  const nextRuntimeUrl = RUNTIME_URL.replace(
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-",
    "123456789_abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ",
  );
  const nextOwnerUrl = OWNER_URL.replace("AbCdEfGhIjKlMn_1", "ZyXwVuTsRqPoNm_2");
  const forceEvidence = {
    schemaVersion: 1,
    operation: "stripe-webhook-event-force-production-postflight",
    source: { clean: true, commit: FORCE_RELEASE_COMMIT },
    target: {
      databaseName: "neondb",
      databaseUrlSha256: createHash("sha256").update(nextRuntimeUrl).digest("hex"),
      endpointId: "ep-plain-river-aaqg8gj4",
      region: "westus3.azure",
      role: "grainline_app_runtime",
    },
    runs: { mainCiRunId: FORCE_MAIN_CI_RUN_ID, migrationRunId: FORCE_MIGRATION_RUN_ID },
    proof: {
      postflightReadOnly: true,
      rlsEnabled: true,
      rlsForced: true,
      publicAuthority: false,
      runtimeTableOrColumnAuthority: false,
    },
    completedAt: "2026-08-13T18:00:00.000Z",
    productionChangedByPostflight: false,
    status: "passed",
  };
  assert.equal(validateForcePostflightEvidence(forceEvidence, nextRuntimeUrl).status, "passed");
  assert.throws(() => validateForcePostflightEvidence({
    ...forceEvidence,
    productionChangedByPostflight: true,
  }, nextRuntimeUrl));

  const state = {
    ...freshRecoveryState(RUNTIME_URL, OWNER_URL),
    stage: "postflight-passed",
    nextRuntimeUrl,
    nextOwnerUrl,
    replacementDeployment: {
      id: "dpl_Replacement123",
      url: "grainline-replacement.vercel.app",
    },
  };
  const recoveryEvidence = {
    schemaVersion: 1,
    operation: "database-credential-exposure-recovery",
    status: "passed",
    acceptanceEligible: true,
    issueCount: 0,
    completedAt: "2026-08-13T18:01:00.000Z",
    operator: { commit: config.operatorCommit, ciRunId: config.operatorCiRunId },
    stripeForce: {
      releaseCommit: FORCE_RELEASE_COMMIT,
      mainCiRunId: FORCE_MAIN_CI_RUN_ID,
      migrationRunId: FORCE_MIGRATION_RUN_ID,
      postflightEvidence:
        `stripe-webhook-event-force-production-postflight-${FORCE_RELEASE_COMMIT}.json`,
    },
    deployment: {
      priorId: PRIOR_DEPLOYMENT_ID,
      replacementId: "dpl_Replacement123",
      sourceCommit: DEPLOYED_SOURCE_COMMIT,
      canonicalRoutes: [
        { route: "/", status: 200, contentType: "text/html; charset=utf-8" },
        { route: "/api/health", status: 200, contentType: "application/json" },
      ],
    },
    credentials: {
      runtime: {
        role: "grainline_app_runtime",
        priorSha256: createHash("sha256").update(RUNTIME_URL).digest("hex"),
        replacementSha256: createHash("sha256").update(nextRuntimeUrl).digest("hex"),
        priorRejected: true,
        replacementVerified: true,
      },
      owner: {
        role: "neondb_owner",
        priorSha256: createHash("sha256").update(OWNER_URL).digest("hex"),
        replacementSha256: createHash("sha256").update(nextOwnerUrl).digest("hex"),
        priorRejected: true,
        replacementVerified: true,
      },
    },
    productionChangedByRecovery: [
      "neon_runtime_password",
      "vercel_production_database_url",
      "vercel_exact_source_redeployment",
      "neon_owner_password",
      "github_production_migration_secret_and_digest",
    ],
    migrationsApplied: [],
    providerScopeOutsideRecoveryChanged: false,
  };
  assert.equal(
    validateRecoveryEvidence(recoveryEvidence, config, state).evidence.status,
    "passed",
  );
  assert.throws(() => validateRecoveryEvidence({
    ...recoveryEvidence,
    migrationsApplied: ["forbidden"],
  }, config, state));
});

test("reviewed runs and definitive password rejection are fail closed", () => {
  const operatorRun = normalizeGithubRun({
    id: 31729999999,
    name: "CI",
    event: "pull_request",
    head_sha: "a".repeat(40),
    status: "completed",
    conclusion: "success",
  }, {
    id: 31729999999,
    name: "CI",
    event: "pull_request",
    headSha: "a".repeat(40),
  });
  assert.equal(operatorRun.conclusion, "success");
  const run = normalizeGithubRun({
    id: FORCE_MAIN_CI_RUN_ID,
    name: "CI",
    event: "push",
    head_sha: FORCE_RELEASE_COMMIT,
    status: "completed",
    conclusion: "success",
  }, {
    id: FORCE_MAIN_CI_RUN_ID,
    name: "CI",
    event: "push",
    headSha: FORCE_RELEASE_COMMIT,
  });
  assert.equal(run.conclusion, "success");
  assert.equal(FORCE_MIGRATION_RUN_ID, 31717354633);
  assert.equal(classifyCredentialProbe({ code: "28P01" }), "rejected");
  assert.throws(() => classifyCredentialProbe({ code: "ETIMEDOUT" }), /definitive/);
});

test("operator never logs secrets and preserves all explicit no-migration boundaries", () => {
  const source = fs.readFileSync(
    "scripts/database-credential-exposure-recovery.mjs",
    "utf8",
  );
  assert.doesNotMatch(source, /console\.(?:log|error)/);
  assert.doesNotMatch(source, /prisma\s+migrate|production-migrations/);
  assert.match(source, /--skip-domain/);
  assert.match(source, /"promote"/);
  assert.match(source, /expectCredentialRejected\(state\.priorRuntimeUrl\)/);
  assert.match(source, /expectCredentialRejected\(state\.priorOwnerUrl\)/);
  assert.match(source, /runStripeWebhookEventForcePostflight/);
  assert.match(source, /migrationsApplied: \[\]/);
  assert.match(source, /providerScopeOutsideRecoveryChanged: false/);
  assert.match(REVIEWED_NEON_CLI_PATH, /eeb76a5ebe01076e/);
  assert.equal(
    REVIEWED_NEON_CLI_INTEGRITY,
    "sha512-gxDmTYDjW8hwhe7WSfuR06jJ2WNdAjBTTJEIM5FXkmgGZpgf/Hp69rZc8PJCKXOsrRiGM1I50luv48I8vkDQww==",
  );
});
