#!/usr/bin/env node
import { randomUUID } from "node:crypto";
import { chmodSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import pg from "pg";
import {
  assertDeterministicPostgresEnvironment,
  assertExplicitPostgresConnectionAuthority,
  assertReviewedPostgresConnectionParameters,
  parseCanonicalPostgresDatabaseName,
  parseExactPostgresUrl,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;
const CONFIRMATION = "staging-only";
const CONNECTION_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 30_000;
const QUERY_TIMEOUT_MS = 35_000;

function required(env, name) {
  const value = env[name];
  if (typeof value !== "string" || value === "") throw new Error(`${name} is required`);
  return value;
}

export function parseForceMaintenanceProofConfig(env = process.env) {
  if (env.SAVED_SEARCH_FORCE_PROOF_CONFIRM !== CONFIRMATION) {
    throw new Error(`SAVED_SEARCH_FORCE_PROOF_CONFIRM=${CONFIRMATION} is required`);
  }
  assertDeterministicPostgresEnvironment(env, "SavedSearch FORCE maintenance proof");
  const connectionString = required(env, "SAVED_SEARCH_FORCE_PROOF_DIRECT_URL");
  const parsed = parseExactPostgresUrl(connectionString, "SAVED_SEARCH_FORCE_PROOF_DIRECT_URL");
  const { username } = assertExplicitPostgresConnectionAuthority(
    parsed,
    "SAVED_SEARCH_FORCE_PROOF_DIRECT_URL",
  );
  const databaseName = parseCanonicalPostgresDatabaseName(
    parsed,
    "SAVED_SEARCH_FORCE_PROOF_DIRECT_URL",
  );
  assertReviewedPostgresConnectionParameters(parsed, "SAVED_SEARCH_FORCE_PROOF_DIRECT_URL");
  if (parsed.hostname.split(".")[0].endsWith("-pooler")) {
    throw new Error("SAVED_SEARCH_FORCE_PROOF_DIRECT_URL must use a direct endpoint");
  }
  const endpointId = required(env, "SAVED_SEARCH_FORCE_PROOF_EXPECTED_DATABASE_ENDPOINT_ID");
  const productionEndpointId = required(env, "SAVED_SEARCH_FORCE_PROOF_PRODUCTION_DATABASE_ENDPOINT_ID");
  const expectedDatabaseName = required(env, "SAVED_SEARCH_FORCE_PROOF_EXPECTED_DATABASE_NAME");
  const expectedRegion = required(env, "SAVED_SEARCH_FORCE_PROOF_EXPECTED_DATABASE_REGION");
  const evidencePath = required(env, "SAVED_SEARCH_FORCE_PROOF_EVIDENCE_PATH");
  const hostnameParts = parsed.hostname.toLowerCase().split(".");
  const actualEndpointId = hostnameParts[0];
  const actualRegion = hostnameParts.slice(1, -2).join(".");
  if (endpointId === productionEndpointId) {
    throw new Error("reviewed staging endpoint must differ from production");
  }
  if (actualEndpointId !== endpointId || databaseName !== expectedDatabaseName
      || actualRegion !== expectedRegion) {
    throw new Error("direct URL does not match the independently reviewed staging identity");
  }
  if (username !== "neondb_owner") {
    throw new Error("FORCE maintenance proof must authenticate as neondb_owner");
  }
  return { connectionString, databaseName, endpointId, evidencePath, username };
}

async function catalogState(client) {
  const result = await client.query(`
    SELECT c.relrowsecurity AS rls_enabled,
           c.relforcerowsecurity AS rls_forced,
           pg_get_userbyid(c.relowner) AS owner_name,
           (SELECT COUNT(*)::integer FROM pg_policy p WHERE p.polrelid = c.oid) AS policy_count
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'SavedSearch'
  `);
  return result.rows[0];
}

function exactForcedState(state) {
  return state?.rls_enabled === true && state?.rls_forced === true
    && state?.owner_name === "neondb_owner" && state?.policy_count === 3;
}

export async function runForceMaintenanceProof(config) {
  const client = new Client({
    connectionString: config.connectionString,
    connectionTimeoutMillis: CONNECTION_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
    ...postgresChannelBindingClientOptions(new URL(config.connectionString)),
  });
  await client.connect();
  const fixtureId = `force-maintenance-${randomUUID()}`;
  let result;
  try {
    const identity = (await client.query(`
      SELECT current_database() AS database_name,
             current_user AS current_user_name,
             session_user AS session_user_name
    `)).rows[0];
    if (identity?.database_name !== config.databaseName
        || identity?.current_user_name !== config.username
        || identity?.session_user_name !== config.username) {
      throw new Error("live owner identity does not match the reviewed direct URL");
    }
    const initialState = await catalogState(client);
    if (!exactForcedState(initialState)) throw new Error("SavedSearch did not begin in exact Phase B FORCE state");
    const ownerVisibleWhileForced = (await client.query(
      'SELECT COUNT(*)::integer AS count FROM public."SavedSearch"',
    )).rows[0]?.count;
    if (ownerVisibleWhileForced !== 0) throw new Error("table owner did not fail closed while FORCE was active");

    await client.query("BEGIN");
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query("SET LOCAL statement_timeout = '30s'");
      await client.query('ALTER TABLE public."SavedSearch" DISABLE ROW LEVEL SECURITY');
      const user = (await client.query('SELECT id FROM public."User" ORDER BY id LIMIT 1')).rows[0];
      if (!user?.id) throw new Error("staging database has no user for the reversible maintenance fixture");
      await client.query(`
        INSERT INTO public."SavedSearch"
          (id, "userId", query, tags, "notifyEmail", "createdAt")
        VALUES ($1, $2, 'force-maintenance-proof', ARRAY[]::text[], false, NOW())
      `, [fixtureId, user.id]);
      const visibleWhileDisabled = (await client.query(
        'SELECT COUNT(*)::integer AS count FROM public."SavedSearch" WHERE id = $1',
        [fixtureId],
      )).rows[0]?.count;
      if (visibleWhileDisabled !== 1) throw new Error("owner maintenance write was not visible while RLS was disabled");
      await client.query('ALTER TABLE public."SavedSearch" ENABLE ROW LEVEL SECURITY');
      await client.query('ALTER TABLE public."SavedSearch" FORCE ROW LEVEL SECURITY');
      const hiddenAfterRestore = (await client.query(
        'SELECT COUNT(*)::integer AS count FROM public."SavedSearch" WHERE id = $1',
        [fixtureId],
      )).rows[0]?.count;
      if (hiddenAfterRestore !== 0) throw new Error("owner fixture remained visible after FORCE restoration");
    } finally {
      await client.query("ROLLBACK");
    }

    await client.query("BEGIN READ WRITE");
    try {
      await client.query("SET LOCAL lock_timeout = '5s'");
      await client.query('ALTER TABLE public."SavedSearch" DISABLE ROW LEVEL SECURITY');
      const residue = (await client.query(
        'SELECT COUNT(*)::integer AS count FROM public."SavedSearch" WHERE id = $1',
        [fixtureId],
      )).rows[0]?.count;
      if (residue !== 0) throw new Error("reversible maintenance fixture survived transaction rollback");
    } finally {
      await client.query("ROLLBACK");
    }
    const finalState = await catalogState(client);
    if (!exactForcedState(finalState)) throw new Error("maintenance proof did not restore exact Phase B FORCE state");
    result = {
      ownerFailsClosedUnderForce: true,
      reversibleOwnerMaintenanceWrite: true,
      rollbackRemovedFixture: true,
      finalForceRestored: true,
      finalPolicyCount: finalState.policy_count,
    };
  } finally {
    await client.end();
  }
  return result;
}

async function main() {
  const config = parseForceMaintenanceProofConfig();
  const checks = await runForceMaintenanceProof(config);
  const payload = {
    generatedAt: new Date().toISOString(),
    acceptanceEligible: true,
    checks,
    issueCount: 0,
    status: "passed",
    target: { database: config.databaseName, endpointId: config.endpointId },
  };
  writeFileSync(config.evidencePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
  chmodSync(config.evidencePath, 0o600);
  console.log(JSON.stringify({ acceptanceEligible: true, issueCount: 0, status: "passed" }));
}

const isDirectExecution = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isDirectExecution) {
  main().catch((error) => {
    const evidencePath = process.env.SAVED_SEARCH_FORCE_PROOF_EVIDENCE_PATH;
    if (typeof evidencePath === "string" && evidencePath !== "") {
      const payload = {
        generatedAt: new Date().toISOString(),
        acceptanceEligible: false,
        issueCount: 1,
        issues: ["SavedSearch FORCE maintenance proof execution failed"],
        status: "failed",
      };
      writeFileSync(evidencePath, `${JSON.stringify(payload, null, 2)}\n`, { mode: 0o600 });
      chmodSync(evidencePath, 0o600);
    }
    console.error(
      `SavedSearch FORCE maintenance proof failed (${error instanceof Error ? error.name : "unknown error"}); inspect the sanitized failed evidence`,
    );
    process.exitCode = 1;
  });
}
