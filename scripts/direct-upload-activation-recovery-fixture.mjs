#!/usr/bin/env node
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import {
  lstatSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  DIRECT_UPLOAD_ACTIVATION_RELEASE,
  FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
} from "./verify-direct-upload-activation-release.mjs";

export const DIRECT_UPLOAD_ACTIVATION_RECOVERY_FIXTURE_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_DIRECT_UPLOAD_ACTIVATION_RECOVERY_FIXTURE";

const MIGRATION_PATH = path.join(
  "prisma",
  "migrations",
  DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
  "migration.sql",
);
const MEMBERSHIP_START = `  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership`;
const MEMBERSHIP_END = `

  SELECT class.relrowsecurity, class.relforcerowsecurity`;
const FAILED_MEMBERSHIP_PREFLIGHT = `  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
      JOIN pg_catalog.pg_roles AS member
        ON member.oid = membership.member
      JOIN pg_catalog.pg_roles AS granted_role
        ON granted_role.oid = membership.roleid
     WHERE member.rolname IN (
             'grainline_app_runtime',
             'grainline_direct_upload_cleanup_v2'
           )
        OR granted_role.rolname IN (
             'grainline_app_runtime',
             'grainline_direct_upload_cleanup_v2'
           )
  ) THEN
    RAISE EXCEPTION
      'DirectUpload runtime or cleanup role retains inbound or outbound role membership';
  END IF;`;

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildFailedDirectUploadActivationFixture(reviewedSql) {
  assert.equal(
    sha256(reviewedSql),
    DIRECT_UPLOAD_ACTIVATION_RELEASE.sha256,
    "DirectUpload recovery fixture requires the corrected reviewed bytes",
  );
  const start = reviewedSql.indexOf(MEMBERSHIP_START);
  const end = reviewedSql.indexOf(MEMBERSHIP_END, start);
  assert.ok(start >= 0 && end > start, "DirectUpload membership preflight markers drifted");
  assert.equal(
    reviewedSql.indexOf(MEMBERSHIP_START, start + 1),
    -1,
    "DirectUpload membership preflight start is not unique",
  );
  const failedSql = `${reviewedSql.slice(0, start)}${FAILED_MEMBERSHIP_PREFLIGHT}${reviewedSql.slice(end)}`;
  assert.equal(
    sha256(failedSql),
    FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
    "DirectUpload failed activation fixture bytes drifted",
  );
  return failedSql;
}

export function parseDirectUploadActivationRecoveryFixtureConfig(
  env = process.env,
  argv = process.argv.slice(2),
) {
  assert.deepEqual(argv, ["--write"], "recovery fixture requires --write");
  assert.equal(env.GITHUB_ACTIONS, "true", "recovery fixture requires GitHub Actions");
  assert.equal(env.CI, "true", "recovery fixture requires CI");
  assert.equal(
    env.DIRECT_UPLOAD_ACTIVATION_RECOVERY_FIXTURE_ACK,
    DIRECT_UPLOAD_ACTIVATION_RECOVERY_FIXTURE_ACK,
    "recovery fixture acknowledgement is invalid",
  );
  const databaseUrl = env.DIRECT_UPLOAD_ACTIVATION_RECOVERY_PROOF_DATABASE_URL;
  assert.ok(databaseUrl, "recovery fixture database URL is required");
  const parsed = new URL(databaseUrl);
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "recovery fixture refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    "/grainline_ci",
    "recovery fixture requires grainline_ci",
  );
  return Object.freeze({
    migrationPath: path.resolve(MIGRATION_PATH),
  });
}

export function writeFailedDirectUploadActivationFixture(config) {
  const stat = lstatSync(config.migrationPath);
  assert.ok(stat.isFile() && !stat.isSymbolicLink(), "activation migration must be a regular file");
  const reviewedSql = readFileSync(config.migrationPath, "utf8");
  const failedSql = buildFailedDirectUploadActivationFixture(reviewedSql);
  writeFileSync(config.migrationPath, failedSql, "utf8");
  assert.equal(
    sha256(readFileSync(config.migrationPath, "utf8")),
    FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
  );
  return Object.freeze({
    migrationName: DIRECT_UPLOAD_ACTIVATION_RELEASE.migrationName,
    failedSha256: FAILED_DIRECT_UPLOAD_ACTIVATION_SHA256,
    productionChanged: false,
    stagedInDisposableCheckout: true,
  });
}

async function main() {
  try {
    const config = parseDirectUploadActivationRecoveryFixtureConfig();
    const result = writeFailedDirectUploadActivationFixture(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    process.stderr.write(
      `DirectUpload activation recovery fixture failed: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
