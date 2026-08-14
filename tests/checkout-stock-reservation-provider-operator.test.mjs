// RLS_CONTEXT_GATE_RUNNER_ONLY_TEST
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS,
  PROVIDER_ENVIRONMENT_KEYS,
  PROVIDER_PROOF_BRANCH,
  REVIEWED_BOOTSTRAP_FAILED_DEPLOYMENT_ID,
  REVIEWED_BOOTSTRAP_FAILED_SOURCE_SHA,
  REVIEWED_CHILD_LOGIN_ROLES,
  REVIEWED_CLEANUP_ROLE,
  REVIEWED_PRODUCTION_ALIASES,
  REVIEWED_PRODUCTION_BRANCH_ID,
  REVIEWED_PRODUCTION_DEPLOYMENT_ID,
  REVIEWED_PRODUCTION_ENDPOINT_ID,
  buildProductionCredentialChallengeUrl,
  providerEnvironmentEntries,
  validateDatabaseUrl,
  validateChildPasswordResetResponse,
  validateProductionNeonBoundary,
  validateProviderEvidence,
  validateProviderState,
} from "../scripts/checkout-stock-reservation-provider-proof-operator.mjs";

const source = readFileSync(
  "scripts/checkout-stock-reservation-provider-proof-operator.mjs",
  "utf8",
);
const vercel = JSON.parse(readFileSync("vercel.json", "utf8"));
const state = Object.freeze({
  adminDatabaseUrl: "postgresql://neondb_owner:owner_secret@ep-proof.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require",
  branch: PROVIDER_PROOF_BRANCH,
  bypassSecret: "b".repeat(48),
  commitSha: "a".repeat(40),
  deploymentId: "dpl_provider_preview",
  neonBranchId: "br-provider-proof",
  neonEndpointId: "ep-proof",
  neonProjectId: "icy-unit-96812898",
  parentBranchId: REVIEWED_PRODUCTION_BRANCH_ID,
  phase: "credentials-ready",
  projectId: "prj_O2S8qcYFFWXn6nnrV0DkLyqMprIp",
  runId: `checkout-reservation-${"r".repeat(36)}`,
  runtimeDatabaseUrl: "postgresql://grainline_app_runtime:runtime_secret@ep-proof-pooler.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full&channel_binding=require",
  teamId: "team_wvQeQHZGwCSwinC1uB7xbpjr",
  triggerSecret: "t".repeat(64),
});

function workload(label, concurrency) {
  return {
    baseline: {
      concurrency,
      errorCount: 0,
      label: `${label}_baseline`,
      maxMs: 150,
      meanMs: 100,
      p95Ms: 120,
      requests: 80,
    },
    candidate: {
      concurrency,
      errorCount: 0,
      label: `${label}_candidate`,
      maxMs: 250,
      meanMs: 150,
      p95Ms: 200,
      requests: 80,
    },
  };
}

function passingEvidence() {
  return {
    config: {
      burstConcurrency: 10,
      measuredRequests: 80,
      prismaPoolSize: 10,
      targetConcurrency: 8,
      warmupRequests: 10,
    },
    database: {
      databaseHost: "ep-proof-pooler.westus3.azure.neon.tech",
      expectedDatabaseEndpointId: "ep-proof",
      expectedDatabaseName: "neondb",
      runtimeRole: "grainline_app_runtime",
    },
    locality: {
      observedDatabaseRegion: "westus3.azure",
      observedExecutionRegion: "sfo1",
      providerRuntimeMetadataPresent: true,
    },
    proofMode: "provider-runtime-checkout-reservation-candidate",
    result: {
      catalog: {
        activeReservations: 0,
        currentUser: "grainline_app_runtime",
        fixtureListings: 20,
        minimumStock: 10_000,
      },
      issueCount: 0,
      sameListingWait: { durationMs: 125, passed: true, waitedForLock: true },
      workloads: {
        burst: workload("same_seller_different_listing_burst", 10),
        target: workload("same_seller_different_listing_target", 8),
      },
    },
    run: {
      commitSha: state.commitSha,
      deploymentId: state.deploymentId,
      status: "runtime_candidate_passed",
    },
    runner: {
      nodeVersion: "v24.1.0",
      runIdSha256: createHash("sha256").update(state.runId).digest("hex"),
      runSlot: 1,
    },
    status: "passed",
  };
}

describe("CheckoutStockReservation provider proof operator", () => {
  it("pins the production branch protection state without assuming password isolation", () => {
    const project = {
      id: "icy-unit-96812898",
      org_id: "org-raspy-frost-18952075",
      region_id: "azure-westus3",
    };
    const production = {
      current_state: "ready",
      default: true,
      id: REVIEWED_PRODUCTION_BRANCH_ID,
      primary: true,
      protected: true,
    };
    const endpoint = {
      branch_id: REVIEWED_PRODUCTION_BRANCH_ID,
      current_state: "idle",
      id: REVIEWED_PRODUCTION_ENDPOINT_ID,
      region_id: "azure-westus3",
      type: "read_write",
    };
    assert.deepEqual(validateProductionNeonBoundary(project, production, endpoint), {
      branchId: REVIEWED_PRODUCTION_BRANCH_ID,
      endpointId: REVIEWED_PRODUCTION_ENDPOINT_ID,
      protected: true,
    });
    assert.deepEqual(
      validateProductionNeonBoundary(project, { ...production, protected: false }, endpoint),
      {
        branchId: REVIEWED_PRODUCTION_BRANCH_ID,
        endpointId: REVIEWED_PRODUCTION_ENDPOINT_ID,
        protected: false,
      },
    );
    assert.throws(
      () => validateProductionNeonBoundary(project, { ...production, protected: undefined }, endpoint),
      /production Neon identity drifted/u,
    );
    assert.throws(
      () => validateProductionNeonBoundary(project, production, {
        ...endpoint,
        id: "ep-unreviewed",
      }),
      /production Neon identity drifted/u,
    );
  });

  it("accepts only exact disposable-role password reset responses", () => {
    const payload = {
      operations: [{
        action: "reset_password",
        branch_id: state.neonBranchId,
        id: "operation-child-reset-1234",
        project_id: state.neonProjectId,
        status: "running",
      }],
      role: {
        authentication_method: "password",
        branch_id: state.neonBranchId,
        name: "grainline_app_runtime",
        password: "fresh_child_password_1234",
        updated_at: "2026-08-13T20:00:00Z",
      },
    };
    const accepted = validateChildPasswordResetResponse(
      payload,
      state,
      "grainline_app_runtime",
    );
    assert.equal(accepted.password, "fresh_child_password_1234");
    assert.equal(accepted.operations[0].id, "operation-child-reset-1234");
    assert.deepEqual(REVIEWED_CHILD_LOGIN_ROLES, [
      "neondb_owner",
      "grainline_app_runtime",
      "grainline_direct_upload_cleanup_v2",
    ]);
    assert.equal(REVIEWED_CLEANUP_ROLE, "grainline_direct_upload_cleanup_v2");
    assert.throws(() => validateChildPasswordResetResponse(
      {
        ...payload,
        role: { ...payload.role, branch_id: REVIEWED_PRODUCTION_BRANCH_ID },
      },
      state,
      "grainline_app_runtime",
    ));
  });

  it("keeps every runtime variable branch-scoped, sensitive and owner-free", () => {
    const entries = providerEnvironmentEntries(state);
    assert.ok(entries.length >= 20);
    assert.deepEqual(entries.map((entry) => entry.key), PROVIDER_ENVIRONMENT_KEYS);
    assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);
    assert.equal(JSON.stringify(entries).includes(REVIEWED_CLEANUP_ROLE), false);
    assert.ok(entries.every((entry) => (
      entry.gitBranch === PROVIDER_PROOF_BRANCH
      && entry.type === "sensitive"
      && entry.target.length === 1
      && entry.target[0] === "preview"
    )));
    assert.deepEqual(
      entries.map((entry) => entry.key).filter((key) => (
        FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes(key)
      )),
      [],
    );
    assert.equal(entries.some((entry) => entry.value === state.adminDatabaseUrl), false);
    assert.equal(entries.some((entry) => entry.key === "RLS_CONTEXT_GATE_DATABASE_URL"), false);
    assert.ok(FORBIDDEN_PROVIDER_ENVIRONMENT_KEYS.includes("RLS_CONTEXT_GATE_DATABASE_URL"));
  });

  it("accepts only the exact child endpoint, role, pool mode and URL controls", () => {
    assert.equal(
      validateDatabaseUrl(state.runtimeDatabaseUrl, state, {
        pooled: true,
        role: "grainline_app_runtime",
      }),
      state.runtimeDatabaseUrl,
    );
    assert.throws(() => validateDatabaseUrl(
      state.runtimeDatabaseUrl.replace("-pooler", ""),
      state,
      { pooled: true, role: "grainline_app_runtime" },
    ));
    const challenged = new URL(buildProductionCredentialChallengeUrl(
      "grainline_app_runtime",
      "runtime_child_secret",
    ));
    assert.equal(
      challenged.hostname,
      `${REVIEWED_PRODUCTION_ENDPOINT_ID}.westus3.azure.neon.tech`,
    );
    assert.equal(challenged.username, "grainline_app_runtime");
    assert.equal(challenged.password, "runtime_child_secret");
    assert.equal(challenged.searchParams.get("sslmode"), "verify-full");
    assert.throws(() => buildProductionCredentialChallengeUrl(
      "unreviewed_role",
      "runtime_child_secret",
    ));
    assert.throws(() => validateDatabaseUrl(
      state.runtimeDatabaseUrl.replace("grainline_app_runtime", "neondb_owner"),
      state,
      { pooled: true, role: "grainline_app_runtime" },
    ));
  });

  it("accepts only the three restart-safe provider state phases", () => {
    const ready = { ...state };
    assert.equal(validateProviderState(ready), ready);
    const created = {
      ...state,
      adminDatabaseUrl: "",
      bypassSecret: "",
      phase: "neon-created",
      runtimeDatabaseUrl: "",
    };
    assert.equal(validateProviderState(created), created);
    const attempted = {
      ...created,
      neonBranchId: "",
      neonEndpointId: "",
      phase: "creation-attempted",
    };
    assert.equal(validateProviderState(attempted), attempted);
    assert.throws(() => validateProviderState({ ...attempted, neonBranchId: "br-unbound" }));
    assert.throws(() => validateProviderState({ ...created, runtimeDatabaseUrl: state.runtimeDatabaseUrl }));
    assert.throws(() => validateProviderState({ ...state, phase: "prepared-ish" }));
  });

  it("pins production read-only while bounding child creation and teardown", () => {
    assert.match(source, new RegExp(REVIEWED_PRODUCTION_DEPLOYMENT_ID));
    assert.deepEqual(REVIEWED_PRODUCTION_ALIASES, [
      "thegrainline.com",
      "www.thegrainline.com",
    ]);
    assert.match(source, /aliasDeployment\?\.id !== REVIEWED_PRODUCTION_DEPLOYMENT_ID/);
    assert.match(source, /deployment\.source !== "cli"/);
    assert.doesNotMatch(source, /deployment\.gitSource\?\.sha !== REVIEWED_PRODUCTION_SOURCE_SHA/);
    assert.match(source, /parent_id: REVIEWED_PRODUCTION_BRANCH_ID/);
    assert.match(source, /typeof production\.protected !== "boolean"/);
    assert.match(source, /branch\.protected !== false/);
    assert.match(source, /roles\/\$\{role\}\/reset_password/);
    assert.doesNotMatch(source, /roles\/\$\{role\}\/reveal_password/);
    assert.match(source, /error\?\.code === "28P01"/);
    assert.match(source, /for \(const role of REVIEWED_CHILD_LOGIN_ROLES\)/);
    assert.match(source, /proveChildPasswordRejectedByProduction\(role, reset\.password\)/);
    assert.match(source, /childPasswords\.get\(REVIEWED_OWNER_ROLE\)/);
    assert.match(source, /childPasswords\.get\(REVIEWED_RUNTIME_ROLE\)/);
    assert.match(source, /expires_at: expiresAt/);
    assert.match(source, /endpoints: \[\{ type: "read_write" \}\]/);
    assert.match(source, /deployment\.target !== null/);
    assert.match(source, /deployment\.uid === REVIEWED_PRODUCTION_DEPLOYMENT_ID/);
    assert.match(source, /production Neon branch disappeared during cleanup/);
    assert.match(source, /phase: "neon-created"/);
    assert.match(source, /await deleteDisposableNeon\(state\)/);
    assert.match(source, /partial provider state cannot complete successful cleanup/);
    assert.doesNotMatch(source, /DELETE FROM public\.(?!"CheckoutStockReservation")/);
  });

  it("keeps main and the exact proof branch disabled between provider attempts", () => {
    assert.equal(vercel.git.deploymentEnabled.main, false);
    assert.equal(vercel.git.deploymentEnabled[PROVIDER_PROOF_BRANCH], false);
    assert.match(source, new RegExp(REVIEWED_BOOTSTRAP_FAILED_DEPLOYMENT_ID));
    assert.match(source, new RegExp(REVIEWED_BOOTSTRAP_FAILED_SOURCE_SHA));
    assert.match(source, /deployment\.readyState !== "ERROR"/);
    assert.match(source, /provider bootstrap requires Git deployment disabled/);
    assert.match(source, /delete-failed-checkout-reservation-bootstrap-preview/);
  });

  it("requires explicit prepare and cleanup confirmations and one-shot slots", () => {
    assert.match(source, /create-disposable-checkout-reservation-provider-proof/);
    assert.match(source, /delete-disposable-checkout-reservation-provider-proof/);
    assert.match(source, /delete-failed-checkout-reservation-provider-proof/);
    assert.match(source, /slot 1 has already been attempted/);
    assert.match(source, /slot 2 requires exactly one passing slot 1/);
    assert.match(source, /failedSlot: runSlot/);
    assert.match(source, /assertNoSensitiveEvidence\(payload, state\)/);
    assert.match(source, /phase: "creation-attempted"/);
    assert.match(source, /configurationAttemptedAt/);
    assert.match(source, /Vercel branch environment contains an unreviewed partial manifest/);
  });

  it("applies the one-statement draft only to the disposable child before provider setup", () => {
    assert.match(source, /docs\/rls-drafts\/checkout-stock-reservation-source-consistency\.sql/);
    const candidate = source.indexOf("await applySourceConsistencyCandidate(state)");
    const bypass = source.indexOf("await createBypassSecret()", candidate);
    const ownerGate = source.indexOf('runOwnerGate(state, "prepare")', candidate);
    const fixtures = source.indexOf("await setupFixtures(state)", candidate);
    assert.ok(candidate >= 0);
    assert.ok(bypass > candidate);
    assert.ok(ownerGate > bypass);
    assert.ok(fixtures > ownerGate);
    assert.doesNotMatch(source, /npx prisma migrate deploy/);
  });

  it("independently revalidates every counted latency and residue bound", () => {
    const accepted = passingEvidence();
    assert.equal(validateProviderEvidence(accepted, state, 1), accepted);
    for (const mutate of [
      (payload) => { payload.result.workloads.target.candidate.p95Ms = 751; },
      (payload) => { payload.result.workloads.burst.candidate.requests = 79; },
      (payload) => { payload.result.sameListingWait.durationMs = 2_001; },
      (payload) => { payload.result.catalog.activeReservations = 1; },
      (payload) => { payload.database.databaseHost = "production.example.invalid"; },
    ]) {
      const rejected = structuredClone(accepted);
      mutate(rejected);
      assert.throws(() => validateProviderEvidence(rejected, state, 1));
    }
  });
});
