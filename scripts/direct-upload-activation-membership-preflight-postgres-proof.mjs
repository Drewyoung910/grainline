#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import pg from "pg";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
} from "./verify-direct-upload-activation-release.mjs";

const { Client } = pg;

const ROLE_PREFLIGHT_START =
  "DO $grainline_direct_upload_activation_role_preflight$";
const ROLE_PREFLIGHT_END =
  "$grainline_direct_upload_activation_role_preflight$;";
const REJECTION =
  /DirectUpload runtime or cleanup role retains unreviewed role membership/u;
const PROBE_ROLES = Object.freeze([
  "grainline_du_direct_member_probe",
  "grainline_du_parent_membership_probe",
  "grainline_du_transitive_member_probe",
]);

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function extractDirectUploadActivationRolePreflight(migrationSql) {
  const start = migrationSql.indexOf(ROLE_PREFLIGHT_START);
  const endStart = migrationSql.indexOf(ROLE_PREFLIGHT_END, start);
  if (
    start < 0
    || endStart < 0
    || migrationSql.indexOf(ROLE_PREFLIGHT_START, start + 1) !== -1
    || migrationSql.indexOf(ROLE_PREFLIGHT_END, endStart + 1) !== -1
  ) {
    throw new Error("DirectUpload activation role preflight markers are not exact");
  }
  const preflight = migrationSql.slice(
    start,
    endStart + ROLE_PREFLIGHT_END.length,
  );
  if (
    !preflight.includes("WITH RECURSIVE restricted_members")
    || !preflight.includes("'grainline_app_runtime'")
    || !preflight.includes("'grainline_direct_upload_cleanup_v2'")
    || !preflight.includes("WHERE rolname <> 'neondb_owner'")
  ) {
    throw new Error("DirectUpload activation role preflight body drifted");
  }
  return preflight;
}

export function parseDirectUploadActivationMembershipProofConfig(
  env = process.env,
) {
  if (env.GITHUB_ACTIONS !== "true" || env.CI !== "true") {
    throw new Error("DirectUpload membership proof requires GitHub CI");
  }
  const databaseUrl =
    env.DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROVIDER_FIXTURE_URL;
  if (typeof databaseUrl !== "string" || databaseUrl !== databaseUrl.trim()) {
    throw new Error("DirectUpload membership proof database URL is invalid");
  }
  const parsed = new URL(databaseUrl);
  if (
    parsed.protocol !== "postgresql:"
    || !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
    || parsed.username !== "cloud_admin"
  ) {
    throw new Error("DirectUpload membership proof refuses a non-loopback fixture");
  }
  return Object.freeze({ databaseUrl });
}

async function inRolledBackTransaction(client, callback) {
  await client.query("BEGIN");
  try {
    return await callback();
  } finally {
    await client.query("ROLLBACK").catch(() => {});
  }
}

async function expectPreflightRejection(client, preflight, statements) {
  await inRolledBackTransaction(client, async () => {
    for (const statement of statements) await client.query(statement);
    await assert.rejects(client.query(preflight), REJECTION);
  });
}

export async function runDirectUploadActivationMembershipProof(config) {
  const migrationSql = readFileSync(
    `prisma/migrations/${DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName}/migration.sql`,
    "utf8",
  );
  if (sha256(migrationSql) !== DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256) {
    throw new Error("DirectUpload membership proof migration bytes drifted");
  }
  const preflight = extractDirectUploadActivationRolePreflight(migrationSql);
  const client = new Client({ connectionString: config.databaseUrl });
  try {
    await client.connect();
    const identity = (await client.query(`
      SELECT current_database() AS database_name, CURRENT_USER AS current_user
    `)).rows[0];
    assert.deepEqual(identity, {
      database_name: "grainline_ci",
      current_user: "cloud_admin",
    });
    const existingProbeCount = Number((await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_roles
      WHERE rolname = ANY($1::text[])
    `, [PROBE_ROLES])).rows[0]?.count);
    assert.equal(existingProbeCount, 0, "membership proof probe role already exists");

    await client.query(preflight);

    await inRolledBackTransaction(client, async () => {
      await client.query(
        "REVOKE grainline_app_runtime FROM neondb_owner",
      );
      await client.query(
        "REVOKE grainline_direct_upload_cleanup_v2 FROM neondb_owner",
      );
      await client.query(preflight);
    });

    await expectPreflightRejection(client, preflight, [
      "CREATE ROLE grainline_du_direct_member_probe NOLOGIN",
      `GRANT grainline_app_runtime TO grainline_du_direct_member_probe
        WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
    ]);

    await expectPreflightRejection(client, preflight, [
      "CREATE ROLE grainline_du_parent_membership_probe NOLOGIN",
      `GRANT grainline_du_parent_membership_probe TO grainline_app_runtime
        WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
    ]);

    await expectPreflightRejection(client, preflight, [
      "CREATE ROLE grainline_du_transitive_member_probe NOLOGIN",
      `GRANT neondb_owner TO grainline_du_transitive_member_probe
        WITH ADMIN FALSE, INHERIT FALSE, SET FALSE`,
    ]);

    await expectPreflightRejection(client, preflight, [
      "REVOKE grainline_app_runtime FROM neondb_owner",
      `GRANT grainline_app_runtime TO neondb_owner
        WITH ADMIN TRUE, INHERIT FALSE, SET TRUE`,
    ]);

    await client.query(preflight);
    const residue = Number((await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
      FROM pg_catalog.pg_roles
      WHERE rolname = ANY($1::text[])
    `, [PROBE_ROLES])).rows[0]?.count);
    assert.equal(residue, 0, "membership proof retained probe roles");
    return Object.freeze({
      checks: 7,
      exactBootstrapEdgesAccepted: true,
      noBootstrapEdgesAccepted: true,
      unexpectedDirectMemberRejected: true,
      restrictedRoleParentRejected: true,
      transitiveMemberRejected: true,
      optionDriftRejected: true,
      residue: 0,
      productionChanged: false,
    });
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  try {
    const result = await runDirectUploadActivationMembershipProof(
      parseDirectUploadActivationMembershipProofConfig(),
    );
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation membership proof failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
