import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CLERK_WEBHOOK_EVENT_INSPECTION_CONFIRMATION,
  CLERK_WEBHOOK_EVENT_MIGRATION,
  ClerkWebhookEventCatalogVerificationError,
  assertClerkWebhookEventInspectionGitState,
  buildClerkWebhookEventCatalogExpectation,
  buildClerkWebhookEventFailureEvidence,
  parseClerkWebhookEventInspectionConfig,
  readClerkWebhookEventCatalog,
  verifyClerkWebhookEventCatalog,
  writeClerkWebhookEventInspectionEvidence,
} from "../scripts/clerk-webhook-event-production-inspect.mjs";

const COMMIT = "a".repeat(40);
const DIRECT_URL =
  "postgresql://neondb_owner:secret@ep-plain-river-aaqg8gj4.westus3.azure.neon.tech:5432/neondb?sslmode=verify-full";

function env(root, state = "compatible") {
  return {
    GITHUB_ACTIONS: "true",
    GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/main",
    GITHUB_RUN_ATTEMPT: "1",
    GITHUB_SHA: COMMIT,
    CLERK_WEBHOOK_EVENT_INSPECT_RELEASE_COMMIT: COMMIT,
    CLERK_WEBHOOK_EVENT_INSPECT_CONFIRM: CLERK_WEBHOOK_EVENT_INSPECTION_CONFIRMATION,
    CLERK_WEBHOOK_EVENT_EXPECTED_STATE: state,
    CLERK_WEBHOOK_EVENT_INSPECT_EVIDENCE_PATH: path.join(
      root,
      `clerk-webhook-event-production-inspection-${COMMIT}-${state}.json`,
    ),
    DIRECT_URL,
    MIGRATION_DB_ROLE: "neondb_owner",
    RUNTIME_DB_ROLE: "grainline_app_runtime",
    PRODUCTION_MIGRATION_DIRECT_URL_SHA256: createHash("sha256").update(DIRECT_URL).digest("hex"),
    RUNNER_TEMP: root,
    PGAPPNAME: "clerk-webhook-event-inspection-test",
    PGCONNECT_TIMEOUT: "10",
  };
}

function functionRows(expectation) {
  return expectation.functions.map((entry) => ({
    function_name: entry.name,
    identity_arguments: entry.identityArguments,
    owner_name: "neondb_owner",
    language_name: "plpgsql",
    function_kind: "f",
    security_definer: true,
    leakproof: false,
    volatility: entry.volatility,
    parallel_safety: entry.parallelSafety,
    function_config: ["search_path=pg_catalog"],
    source_md5: entry.sourceMd5,
    runtime_execute: true,
    public_execute: false,
    nonowner_acl: ["grainline_app_runtime:EXECUTE:false"],
  }));
}

function catalog(expectation, state = "complete") {
  const complete = state === "complete";
  return {
    identity: {
      current_user: "neondb_owner",
      session_user: "neondb_owner",
      database_name: "neondb",
      read_only: "on",
      isolation: "repeatable read",
      owner_bypass_rls: true,
      runtime_bypass_rls: false,
      runtime_superuser: false,
      runtime_inherit: false,
    },
    migrations: complete ? [{
      migration_name: CLERK_WEBHOOK_EVENT_MIGRATION,
      checksum: expectation.checksum,
      finished: true,
      rolled_back: false,
      applied_steps_count: "1",
    }] : [],
    table: {
      table_name: "ClerkWebhookEvent",
      owner_name: "neondb_owner",
      rls_enabled: false,
      rls_forced: false,
      policy_count: 0,
      runtime_select: true,
      runtime_insert: true,
      runtime_update: true,
      runtime_delete: true,
      public_select: false,
      public_insert: false,
      public_update: false,
      public_delete: false,
    },
    columns: complete ? [{
      column_name: "claimGeneration",
      data_type: "bigint",
      not_null: true,
      default_expression: "'0'::bigint",
    }] : [],
    constraints: complete ? [{
      constraint_name: "ClerkWebhookEvent_claimGeneration_check",
      constraint_type: "c",
      validated: true,
      definition: "CHECK ((\"claimGeneration\" >= 0))",
    }] : [],
    functions: complete ? functionRows(expectation) : [],
  };
}

test("expectation is derived from exact reviewed migration bytes and five function bodies", () => {
  const expectation = buildClerkWebhookEventCatalogExpectation();
  const sql = fs.readFileSync(
    `prisma/migrations/${CLERK_WEBHOOK_EVENT_MIGRATION}/migration.sql`,
    "utf8",
  );
  assert.equal(expectation.checksum, createHash("sha256").update(sql).digest("hex"));
  assert.equal(expectation.checksum, "c5926434597a96db649796a3c61e633827fb575ae3c29e2570efb0460e9ca643");
  assert.equal(expectation.functions.length, 5);
  assert.equal(new Set(expectation.functions.map(({ sourceMd5 }) => sourceMd5)).size, 5);
  for (const entry of expectation.functions) {
    assert.equal(entry.language, "plpgsql");
    assert.equal(entry.volatility, "v");
    assert.equal(entry.parallelSafety, "u");
  }
});

test("config requires an exact first-attempt main dispatch, owner target, digest, state, and fresh path", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-webhook-inspect-"));
  const parsed = parseClerkWebhookEventInspectionConfig(env(root));
  assert.equal(parsed.releaseCommit, COMMIT);
  assert.deepEqual(parsed.acceptedStates, ["pending", "complete"]);
  assert.equal(parsed.identity.isPooler, false);

  for (const [key, value] of [
    ["GITHUB_RUN_ATTEMPT", "2"],
    ["GITHUB_REF", "refs/heads/other"],
    ["GITHUB_SHA", "b".repeat(40)],
    ["CLERK_WEBHOOK_EVENT_INSPECT_CONFIRM", "wrong"],
    ["CLERK_WEBHOOK_EVENT_EXPECTED_STATE", "unknown"],
    ["MIGRATION_DB_ROLE", "wrong"],
    ["PRODUCTION_MIGRATION_DIRECT_URL_SHA256", "b".repeat(64)],
  ]) {
    assert.throws(() => parseClerkWebhookEventInspectionConfig({ ...env(root), [key]: value }));
  }
  assert.throws(() => parseClerkWebhookEventInspectionConfig({ ...env(root), DATABASE_URL: DIRECT_URL }));
  assert.throws(() => parseClerkWebhookEventInspectionConfig({ ...env(root), GRANT_AUDIT_DATABASE_URL: DIRECT_URL }));
  fs.writeFileSync(env(root).CLERK_WEBHOOK_EVENT_INSPECT_EVIDENCE_PATH, "occupied");
  assert.throws(() => parseClerkWebhookEventInspectionConfig(env(root)));
});

test("git state must be exact and clean", () => {
  assert.deepEqual(
    assertClerkWebhookEventInspectionGitState({ head: COMMIT, status: "" }, COMMIT),
    { head: COMMIT, clean: true },
  );
  assert.throws(() => assertClerkWebhookEventInspectionGitState({ head: "b".repeat(40), status: "" }, COMMIT));
  assert.throws(() => assertClerkWebhookEventInspectionGitState({ head: COMMIT, status: " M file" }, COMMIT));
});

test("pending and complete catalogs are accepted only in their allowed states", () => {
  const expectation = buildClerkWebhookEventCatalogExpectation();
  assert.equal(verifyClerkWebhookEventCatalog(catalog(expectation, "pending"), expectation).state, "pending");
  const complete = verifyClerkWebhookEventCatalog(catalog(expectation), expectation);
  assert.deepEqual(complete, {
    state: "complete",
    migrationApplied: true,
    installedFunctionCount: 5,
    reviewedFunctionCount: 5,
    rlsEnabled: false,
    rlsForced: false,
    predecessorRuntimeCrudRetained: true,
    rowDataRead: false,
    productionChanged: false,
  });
  assert.throws(() => verifyClerkWebhookEventCatalog(catalog(expectation, "pending"), expectation, ["complete"]));
  assert.throws(() => verifyClerkWebhookEventCatalog(catalog(expectation), expectation, ["pending"]));
});

test("catalog verification rejects migration, column, constraint, function, grant, and RLS drift", () => {
  const expectation = buildClerkWebhookEventCatalogExpectation();
  const mutations = [
    (value) => { value.migrations[0].checksum = "b".repeat(64); },
    (value) => { value.columns[0].not_null = false; },
    (value) => { value.columns[0].default_expression = "1"; },
    (value) => { value.constraints[0].validated = false; },
    (value) => { value.constraints[0].definition = "CHECK (true)"; },
    (value) => { value.functions[0].source_md5 = "0".repeat(32); },
    (value) => { value.functions[0].public_execute = true; },
    (value) => { value.functions[0].runtime_execute = false; },
    (value) => { value.functions[0].function_config = []; },
    (value) => { value.table.rls_enabled = true; },
    (value) => { value.table.runtime_delete = false; },
    (value) => { value.table.public_select = true; },
  ];
  for (const mutate of mutations) {
    const value = structuredClone(catalog(expectation));
    mutate(value);
    assert.throws(() => verifyClerkWebhookEventCatalog(value, expectation));
  }
});

test("catalog reader issues only metadata queries and retains no row data", async () => {
  const expectation = buildClerkWebhookEventCatalogExpectation();
  const value = catalog(expectation);
  const results = [value.identity, value.migrations, value.table, value.columns, value.constraints, value.functions];
  const calls = [];
  const client = {
    query: async (sql, parameters) => {
      calls.push({ sql, parameters });
      const result = results.shift();
      return { rows: Array.isArray(result) ? result : [result] };
    },
  };
  const actual = await readClerkWebhookEventCatalog(client, expectation);
  assert.equal(actual.functions.length, 5);
  assert.equal(calls.length, 6);
  const combined = calls.map(({ sql }) => sql).join("\n");
  assert.match(combined, /pg_catalog\.pg_proc/u);
  assert.match(combined, /public\._prisma_migrations/u);
  assert.doesNotMatch(combined, /SELECT\s+\*\s+FROM\s+public\."ClerkWebhookEvent"/iu);
});

test("failure evidence is sanitized and evidence files are private, fresh regular files", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "clerk-webhook-evidence-"));
  const file = path.join(root, "evidence.json");
  const expectation = buildClerkWebhookEventCatalogExpectation();
  const error = new ClerkWebhookEventCatalogVerificationError(
    new Error("catalog drift"),
    catalog(expectation, "pending"),
  );
  const evidence = buildClerkWebhookEventFailureEvidence(
    { mode: "read-only", releaseCommit: COMMIT, directUrlSha256: "c".repeat(64) },
    { head: COMMIT, clean: true },
    error,
  );
  writeClerkWebhookEventInspectionEvidence(file, evidence);
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const saved = fs.readFileSync(file, "utf8");
  assert.doesNotMatch(saved, /postgres(?:ql)?:\/\//iu);
  assert.doesNotMatch(saved, /svixId|functionBodies"\s*:\s*true/iu);
  assert.throws(() => writeClerkWebhookEventInspectionEvidence(file, evidence));
  assert.throws(() => writeClerkWebhookEventInspectionEvidence(
    path.join(root, "bad.json"),
    { leaked: DIRECT_URL },
  ));
});
