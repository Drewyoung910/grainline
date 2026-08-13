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
  parseRecoveryConfig,
  assertRecoveryReleaseGitState,
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
});

test("deployment boundaries pin the prior production and exact-source replacement", () => {
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
    meta: { gitCommitSha: DEPLOYED_SOURCE_COMMIT, gitCommitRef: "HEAD" },
  });
  assert.equal(candidate.id, "dpl_Replacement123");
  assert.throws(() => normalizeCandidateDeployment({
    id: "dpl_Replacement123",
    projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
    readyState: "READY",
    target: "production",
    url: "grainline-replacement.vercel.app",
    meta: { gitCommitSha: FORCE_RELEASE_COMMIT, gitCommitRef: "HEAD" },
  }));
});

test("reviewed runs and definitive password rejection are fail closed", () => {
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
