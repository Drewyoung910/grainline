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
  REVIEWED_PRODUCTION_ALIASES,
  REVIEWED_PRODUCTION_BRANCH_ID,
  REVIEWED_PRODUCTION_DEPLOYMENT_ID,
  providerEnvironmentEntries,
  validateDatabaseUrl,
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
  it("keeps every runtime variable branch-scoped, sensitive and owner-free", () => {
    const entries = providerEnvironmentEntries(state);
    assert.ok(entries.length >= 20);
    assert.deepEqual(entries.map((entry) => entry.key), PROVIDER_ENVIRONMENT_KEYS);
    assert.equal(new Set(entries.map((entry) => entry.key)).size, entries.length);
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

  it("keeps bootstrap deployment disabled and deletes only the exact failed Preview", () => {
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
