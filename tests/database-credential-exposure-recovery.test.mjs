import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import test from "node:test";
import {
  BASELINE_MAIN_CI_RUN_ID,
  BASELINE_MAIN_COMMIT,
  DEPLOYED_SOURCE_COMMIT,
  PRIOR_DEPLOYMENT_ID,
  PRIOR_DEPLOYMENT_URL,
  RECOVERY_CONFIRMATION,
  assertRecoveryReleaseGitState,
  assertRecoveryVercelStage,
  classifyCredentialProbe,
  freshRecoveryState,
  normalizeCandidateDeployment,
  normalizeCanonicalAliasTargets,
  normalizeGithubRun,
  normalizePriorDeployment,
  normalizeRecoveryStateReleaseHandoff,
  normalizeRecoveryVercelState,
  normalizeReplacementDeploymentInventory,
  parseRecoveryConfig,
  recoveryDeploymentMarker,
  validateRecoveryEvidence,
  validateRecoveryState,
} from "../scripts/database-credential-exposure-recovery.mjs";
import {
  REVIEWED_NEON_CLI_INTEGRITY,
  REVIEWED_NEON_CLI_PATH,
  validateNeonRuntimeResetResponse,
} from "../scripts/neon-owner-password-control.mjs";

const RUNTIME_PASSWORD =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_-";
const NEXT_RUNTIME_PASSWORD =
  "123456789_abcdefghijklmnopqrstuvwxyz-ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const RUNTIME_URL =
  `postgresql://grainline_app_runtime:${RUNTIME_PASSWORD}@ep-plain-river-aaqg8gj4-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require`;
const OWNER_URL =
  "postgresql://neondb_owner:AbCdEfGhIjKlMn_1@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require";
const NEXT_OWNER_URL = OWNER_URL.replace("AbCdEfGhIjKlMn_1", "ZyXwVuTsRqPoNm_2");

function configEnvironment(commit = "a".repeat(40)) {
  return {
    DATABASE_CREDENTIAL_RECOVERY_CONFIRM: RECOVERY_CONFIRMATION,
    DATABASE_CREDENTIAL_RECOVERY_OPERATOR_COMMIT: commit,
    DATABASE_CREDENTIAL_RECOVERY_OPERATOR_CI_RUN_ID: "33620000000",
  };
}

test("recovery config is exact-commit sealed and rejects ambient database credentials", () => {
  assert.equal(parseRecoveryConfig(configEnvironment()).operatorCommit, "a".repeat(40));
  assert.throws(() => parseRecoveryConfig(configEnvironment("short")), /invalid/);
  assert.throws(
    () => parseRecoveryConfig({ ...configEnvironment(), DATABASE_URL: RUNTIME_URL }),
    /rejects ambient PostgreSQL credentials/,
  );
  assert.throws(
    () => parseRecoveryConfig({ ...configEnvironment(), DIRECT_URL: OWNER_URL }),
    /rejects ambient PostgreSQL credentials/,
  );
});
test("release commit is a one-file child that pins the implementation source hash", () => {
  const operatorSource = fs.readFileSync(
    "scripts/database-credential-exposure-recovery.mjs",
    "utf8",
  );
  const manifest = {
    implementationCommit: "b".repeat(40),
    operatorSourceSha256: createHash("sha256").update(operatorSource).digest("hex"),
  };
  assert.equal(assertRecoveryReleaseGitState({
    head: "a".repeat(40),
    parents: ["b".repeat(40)],
    changedPaths: ["docs/database-credential-recovery-20260902-release.json"],
    status: "",
  }, { operatorCommit: "a".repeat(40) }, manifest, operatorSource).clean, true);
  assert.throws(() => assertRecoveryReleaseGitState({
    head: "a".repeat(40),
    parents: ["c".repeat(40)],
    changedPaths: ["docs/database-credential-recovery-20260902-release.json"],
    status: "",
  }, { operatorCommit: "a".repeat(40) }, manifest, operatorSource));
});

test("runtime reset response remains pinned to the reviewed role and target", () => {
  const payload = {
    role: {
      branch_id: "br-hidden-mouse-aaugn2wr",
      name: "grainline_app_runtime",
      authentication_method: "password",
      updated_at: "2026-09-02T17:00:00Z",
      password: RUNTIME_PASSWORD,
    },
    operations: [{
      id: "operation-1234",
      project_id: "icy-unit-96812898",
      branch_id: "br-hidden-mouse-aaugn2wr",
      action: "reset_password",
      status: "running",
    }],
  };
  assert.equal(validateNeonRuntimeResetResponse(payload).password, RUNTIME_PASSWORD);
  assert.throws(() => validateNeonRuntimeResetResponse({
    ...payload,
    role: { ...payload.role, name: "neondb_owner" },
  }));
  assert.throws(() => validateNeonRuntimeResetResponse({
    ...payload,
    role: { ...payload.role, password: "too-short" },
  }));
});

test("private restart state pins identities and requires owner recovery before runtime stages", () => {
  const state = freshRecoveryState(RUNTIME_URL, OWNER_URL);
  assert.equal(validateRecoveryState(state).stage, "preflight");
  assert.throws(() => validateRecoveryState({ ...state, stage: "unknown" }));
  assert.throws(() => validateRecoveryState({
    ...state,
    stage: "owner-reset-finished",
  }), /owner credential/);
  const ownerFinished = {
    ...state,
    stage: "owner-reset-finished",
    nextOwnerUrl: NEXT_OWNER_URL,
    ownerRoleUpdatedAtBefore: "2026-09-02T17:00:00.000Z",
    ownerRoleUpdatedAtAfter: "2026-09-02T17:00:01.000Z",
  };
  assert.equal(validateRecoveryState(ownerFinished).stage, "owner-reset-finished");
  assert.throws(() => validateRecoveryState({
    ...ownerFinished,
    stage: "runtime-reset-finished",
  }), /runtime credential/);
  const runtimeFinished = {
    ...ownerFinished,
    stage: "runtime-reset-finished",
    nextRuntimeUrl: RUNTIME_URL.replace(RUNTIME_PASSWORD, NEXT_RUNTIME_PASSWORD),
    runtimeRoleUpdatedAtBefore: "2026-09-02T17:00:00.000Z",
    runtimeRoleUpdatedAtAfter: "2026-09-02T17:00:02.000Z",
  };
  assert.equal(validateRecoveryState(runtimeFinished).stage, "runtime-reset-finished");
});

test("private restart state never crosses release boundaries", () => {
  const state = freshRecoveryState(RUNTIME_URL, OWNER_URL, {
    operatorCommit: "a".repeat(40),
    operatorCiRunId: 1,
  });
  assert.equal(normalizeRecoveryStateReleaseHandoff(
    state,
    { operatorCommit: "a".repeat(40), operatorCiRunId: 1 },
  ), state);
  assert.throws(() => normalizeRecoveryStateReleaseHandoff(
    state,
    { operatorCommit: "b".repeat(40), operatorCiRunId: 2 },
  ), /another release/);
});

test("deployment boundaries pin the current production and exact-source replacement", () => {
  const createdAt = "2026-09-02T17:00:00.000Z";
  const prior = normalizePriorDeployment({
    id: PRIOR_DEPLOYMENT_ID,
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    readyState: "READY",
    target: "production",
    source: "cli",
    url: PRIOR_DEPLOYMENT_URL,
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
      grainlineCredentialRecovery: recoveryDeploymentMarker(createdAt),
    },
  }, createdAt);
  assert.equal(candidate.id, "dpl_Replacement123");
  assert.throws(() => normalizeCandidateDeployment({
    ...candidate,
    projectId: "prj_wrong",
    meta: {
      gitCommitSha: DEPLOYED_SOURCE_COMMIT,
      gitCommitRef: "HEAD",
      grainlineCredentialRecovery: recoveryDeploymentMarker(createdAt),
    },
  }, createdAt));
});

test("canonical alias proof rejects partial promotion", () => {
  const deploymentId = "dpl_Replacement123";
  const hosts = ["thegrainline.com", "www.thegrainline.com", "grainline.vercel.app"];
  const targets = (ids) => hosts.map((hostname, index) => ({
    hostname,
    deployment: {
      id: ids[index],
      projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
      readyState: "READY",
      target: "production",
      alias: [],
    },
  }));
  assert.equal(normalizeCanonicalAliasTargets(
    targets(Array(3).fill(deploymentId)), deploymentId,
  ).stage, "promoted");
  assert.throws(() => normalizeCanonicalAliasTargets(
    targets([deploymentId, "dpl_Previous123", "dpl_Previous123"]), deploymentId,
  ), /partial/);
});

test("Vercel inventory accepts runtime-only scope and rejects privilege drift", () => {
  const projectId = "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp";
  const sharedId = "env_TestRetainedSharedDatabase";
  const reviewed = {
    developmentDatabaseValueSha256: "0".repeat(64),
    developmentCreatedAt: 10,
    developmentUpdatedAt: 10,
    projectId,
    sharedDatabaseEnvironmentIdSha256: createHash("sha256")
      .update(sharedId).digest("hex"),
    sharedCreatedAt: 20,
    sharedUpdatedAt: 21,
  };
  const project = { envs: [
    { key: "DATABASE_URL", type: "sensitive", target: ["production"], gitBranch: null },
    { key: "RUNTIME_DB_ROLE", type: "sensitive", target: ["production"], gitBranch: null },
  ] };
  const shared = {
    data: [{
      id: sharedId,
      key: "DATABASE_URL",
      type: "encrypted",
      target: ["development", "preview", "production"],
      projectId: [],
      createdAt: 20,
      updatedAt: 22,
    }],
    pagination: { count: 1, next: null },
  };
  assert.equal(normalizeRecoveryVercelState(project, shared, reviewed).stage, "runtime-only");
  assert.throws(() => normalizeRecoveryVercelState({
    envs: [...project.envs, {
      key: "DIRECT_URL", type: "sensitive", target: ["production"], gitBranch: null,
    }],
  }, shared, reviewed), /privileged/);
  assert.equal(assertRecoveryVercelStage("preflight", "runtime-only"), true);
  assert.throws(
    () => assertRecoveryVercelStage("preflight", "development-removed"),
    /restart stage/,
  );
});

test("replacement deployment inventory recovers one lost provider response", () => {
  const createdAt = "2026-09-02T17:00:00.000Z";
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
  assert.throws(() => normalizeReplacementDeploymentInventory({
    deployments: [deployment, { ...deployment, id: "dpl_Replacement456" }],
    pagination: { count: 2, next: null },
  }, createdAt), /ambiguous/);
});

test("sanitized recovery evidence accepts only exact replacement proof", () => {
  const config = { operatorCommit: "a".repeat(40), operatorCiRunId: 33620000000 };
  const nextRuntimeUrl = RUNTIME_URL.replace(RUNTIME_PASSWORD, NEXT_RUNTIME_PASSWORD);
  const state = {
    ...freshRecoveryState(RUNTIME_URL, OWNER_URL, config),
    stage: "postflight-passed",
    nextRuntimeUrl,
    nextOwnerUrl: NEXT_OWNER_URL,
    replacementDeployment: {
      id: "dpl_Replacement123",
      url: "grainline-replacement.vercel.app",
    },
  };
  const evidence = {
    schemaVersion: 1,
    operation: "database-credential-exposure-recovery",
    status: "passed",
    acceptanceEligible: true,
    issueCount: 0,
    completedAt: "2026-09-02T18:01:00.000Z",
    operator: { commit: config.operatorCommit, ciRunId: config.operatorCiRunId },
    grantAudit: {
      baselineMainCommit: BASELINE_MAIN_COMMIT,
      baselineMainCiRunId: BASELINE_MAIN_CI_RUN_ID,
      readOnly: true,
      issueCount: 0,
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
        replacementSha256: createHash("sha256").update(NEXT_OWNER_URL).digest("hex"),
        priorRejected: true,
        replacementVerified: true,
      },
    },
    productionChangedByRecovery: [
      "neon_owner_password",
      "github_production_migration_secret_and_digest",
      "neon_runtime_password",
      "vercel_production_database_url",
      "vercel_exact_source_redeployment",
    ],
    migrationsApplied: [],
    vercel: {
      runtimeOnlyBeforeRecovery: true,
      developmentDatabaseUrlAbsent: true,
      previewDatabaseUrlAbsent: true,
    },
    providerScopeOutsideRecoveryChanged: false,
  };
  assert.equal(validateRecoveryEvidence(evidence, config, state).evidence.status, "passed");
  assert.throws(() => validateRecoveryEvidence({
    ...evidence,
    migrationsApplied: ["forbidden"],
  }, config, state));
  assert.throws(() => validateRecoveryEvidence({
    ...evidence,
    grantAudit: { ...evidence.grantAudit, issueCount: 1 },
  }, config, state));
});

test("reviewed runs and definitive old-password rejection remain fail closed", () => {
  const run = normalizeGithubRun({
    id: BASELINE_MAIN_CI_RUN_ID,
    name: "CI",
    event: "push",
    head_sha: BASELINE_MAIN_COMMIT,
    status: "completed",
    conclusion: "success",
  }, {
    id: BASELINE_MAIN_CI_RUN_ID,
    name: "CI",
    event: "push",
    headSha: BASELINE_MAIN_COMMIT,
  });
  assert.equal(run.conclusion, "success");
  assert.equal(classifyCredentialProbe({ code: "28P01" }), "rejected");
  assert.throws(() => classifyCredentialProbe({ code: "ETIMEDOUT" }), /definitive/);
});

test("operator is owner-first, read-only-audited, silent, and has no migration surface", () => {
  const source = fs.readFileSync(
    "scripts/database-credential-exposure-recovery.mjs",
    "utf8",
  );
  assert.doesNotMatch(source, /console\.(?:log|error)/);
  assert.doesNotMatch(source, /prisma\s+migrate|production-migrations/);
  assert.match(source, /--skip-domain/);
  assert.match(source, /"promote"/);
  assert.ok(
    source.indexOf('writeRecoveryState(state, "owner-reset-started")')
      < source.indexOf('writeRecoveryState(state, "runtime-reset-started")'),
  );
  assert.match(source, /expectCredentialRejected\(state\.priorOwnerUrl\)/);
  assert.match(source, /expectCredentialRejected\(state\.priorRuntimeUrl\)/);
  assert.match(source, /BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY/);
  assert.match(source, /auditLiveDatabase/);
  assert.match(source, /\["development", "preview"\]/);
  assert.match(source, /migrationsApplied: \[\]/);
  assert.match(source, /providerScopeOutsideRecoveryChanged: false/);
  assert.match(REVIEWED_NEON_CLI_PATH, /eeb76a5ebe01076e/);
  assert.equal(
    REVIEWED_NEON_CLI_INTEGRITY,
    "sha512-gxDmTYDjW8hwhe7WSfuR06jJ2WNdAjBTTJEIM5FXkmgGZpgf/Hp69rZc8PJCKXOsrRiGM1I50luv48I8vkDQww==",
  );
});
