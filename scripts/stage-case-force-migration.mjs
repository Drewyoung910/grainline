#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CASE_FORCE_MIGRATION =
  "20260804191000_force_case_rls";
export const CASE_FORCE_DRAFT =
  "docs/rls-drafts/case-case-message-force.sql";
export const CASE_FORCE_DRAFT_SHA256 =
  "2620be10dba8e1c9074742f925e7f146ce2a8f4acaea4b6a6dd88e0a0b92b4d9";
export const CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION =
  "docs/rls-drafts/case-case-message-force-runtime-membership.sql";
export const CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION_SHA256 =
  "9332c0a5e2139944c41e5c386ec130f5e8c0e22dfcd439fde9af6413fc6c5839";
export const CASE_FORCE_STAGING_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_CASE_FORCE_STAGING";

const draftHeader =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const migrationHeader = [
  "-- Reviewed posture-only Case-family FORCE hardening.",
  "-- Apply only through the guarded main-only production migration workflow.",
].join("\n");
const protectedTables = Object.freeze([
  "Case",
  "CaseMessage",
  "CaseMessageAttachment",
]);
const historicalMembershipPreflight = `  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.member = runtime_role_oid
        OR membership.roleid = runtime_role_oid
  ) THEN
    RAISE EXCEPTION
      'grainline_app_runtime must remain membership-free before Case FORCE';
  END IF;`;

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function buildCaseForceCandidate(rootDirectory = process.cwd()) {
  const draft = fs.readFileSync(
    path.join(rootDirectory, CASE_FORCE_DRAFT),
    "utf8",
  );
  const draftSha256 = sha256(draft);
  if (draftSha256 !== CASE_FORCE_DRAFT_SHA256) {
    throw new Error(
      `${CASE_FORCE_DRAFT} byte pin drifted: expected `
      + `${CASE_FORCE_DRAFT_SHA256}, got ${draftSha256}`,
    );
  }
  if (!draft.startsWith(`${draftHeader}\n`)) {
    throw new Error("Case FORCE draft header is missing");
  }

  const membershipCorrection = fs.readFileSync(
    path.join(rootDirectory, CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION),
    "utf8",
  );
  const membershipCorrectionSha256 = sha256(membershipCorrection);
  if (
    membershipCorrectionSha256
      !== CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION_SHA256
  ) {
    throw new Error(
      `${CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION} byte pin drifted: expected `
      + `${CASE_FORCE_RUNTIME_MEMBERSHIP_CORRECTION_SHA256}, got `
      + membershipCorrectionSha256,
    );
  }
  const membershipStart = membershipCorrection.indexOf("  IF EXISTS (");
  if (
    membershipStart < 0
    || !membershipCorrection.startsWith("-- Reviewed production correction")
  ) {
    throw new Error("Case FORCE membership correction shape drifted");
  }
  const reviewedMembershipPreflight = membershipCorrection
    .slice(membershipStart)
    .trimEnd();
  if (
    !draft.includes(historicalMembershipPreflight)
    || draft.indexOf(historicalMembershipPreflight)
      !== draft.lastIndexOf(historicalMembershipPreflight)
  ) {
    throw new Error("historical Case FORCE membership preflight drifted");
  }

  const migration = draft
    .replace(draftHeader, migrationHeader)
    .replace(historicalMembershipPreflight, reviewedMembershipPreflight);
  const forbidden = [
    /DRAFT ONLY/,
    /\bCREATE\s+POLICY\b/i,
    /\bDROP\s+POLICY\b/i,
    /^\s*(?:GRANT|REVOKE)\b/im,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
    /\bDROP\s+FUNCTION\b/i,
    /\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(migration)) {
      throw new Error(
        `Case FORCE candidate crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  if (
    count(migration, /^BEGIN;$/gm) !== 1
    || count(migration, /^COMMIT;$/gm) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" FORCE ROW LEVEL SECURITY;$/gm,
    ) !== protectedTables.length
    || count(migration, /IF accepted_table_count <> 3/g) !== 1
    || count(migration, /IF accepted_function_count <> 27/g) !== 1
    || count(migration, /IF invariant_definer_function_count <> 5/g) !== 1
    || count(migration, /IF invariant_invoker_function_count <> 3/g) !== 1
    || count(migration, /IF forced_table_count <> 3/g) !== 1
  ) {
    throw new Error("Case FORCE candidate catalog count drifted");
  }

  for (const table of protectedTables) {
    if (
      !migration.includes(
        `ALTER TABLE public."${table}" FORCE ROW LEVEL SECURITY;`,
      )
    ) {
      throw new Error(`Case FORCE candidate omitted ${table}`);
    }
  }

  return Object.freeze({
    migration,
    migrationSha256: sha256(migration),
    membershipCorrectionSha256,
  });
}

function assertDisposableTarget() {
  if (process.env.CASE_FORCE_STAGING_ACK !== CASE_FORCE_STAGING_ACK) {
    throw new Error("disposable Case FORCE acknowledgement is missing");
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error("DIRECT_URL is required for disposable Case FORCE staging");
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "Case FORCE migration may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths(rootDirectory = process.cwd()) {
  const directory = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    CASE_FORCE_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration, rootDirectory = process.cwd()) {
  const { directory, migrationPath } = candidatePaths(rootDirectory);
  if (fs.existsSync(directory)) {
    throw new Error(`Case FORCE migration destination exists: ${directory}`);
  }
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(migrationPath, migration, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function unstageCandidate(migration, rootDirectory = process.cwd()) {
  const { directory, migrationPath } = candidatePaths(rootDirectory);
  if (!fs.existsSync(directory)) {
    throw new Error("Case FORCE migration destination does not exist");
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error("refusing to remove drifted Case FORCE migration");
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-case-force-migration.mjs "
      + "[--verify|--stage|--unstage]",
    );
  }
  const candidate = buildCaseForceCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: CASE_FORCE_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    membershipCorrectionSha256: candidate.membershipCorrectionSha256,
    protectedTables: protectedTables.length,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    rowDataChanged: false,
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Case FORCE staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
