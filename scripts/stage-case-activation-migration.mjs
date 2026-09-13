#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CASE_ACTIVATION_MIGRATION =
  "20260804160000_enable_case_rls";
export const CASE_ACTIVATION_DRAFT =
  "docs/rls-drafts/case-case-message-activation.sql";
export const CASE_ACTIVATION_DRAFT_SHA256 =
  "99ddbca8ede5144e7f3d7482bc8c0360b7b4acf4ca0e69ebd6836fa715e5f8ab";
export const CASE_ACTIVATION_STAGING_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_CASE_ACTIVATION_STAGING";

const draftHeader =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const migrationHeader = [
  "-- Promoted reviewed policyless Case-family ENABLE activation.",
  "-- FORCE RLS remains off for the separate post-activation hardening release.",
].join("\n");
const protectedTables = Object.freeze([
  "Case",
  "CaseMessage",
  "CaseMessageAttachment",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function buildCaseActivationCandidate(rootDirectory = process.cwd()) {
  const draft = fs.readFileSync(
    path.join(rootDirectory, CASE_ACTIVATION_DRAFT),
    "utf8",
  );
  const draftSha256 = sha256(draft);
  if (draftSha256 !== CASE_ACTIVATION_DRAFT_SHA256) {
    throw new Error(
      `${CASE_ACTIVATION_DRAFT} byte pin drifted: expected `
      + `${CASE_ACTIVATION_DRAFT_SHA256}, got ${draftSha256}`,
    );
  }
  if (!draft.startsWith(`${draftHeader}\n`)) {
    throw new Error("Case activation draft header is missing");
  }

  const migration = draft.replace(draftHeader, migrationHeader);
  const forbidden = [
    /DRAFT ONLY/,
    /\bCREATE\s+POLICY\b/i,
    /\bDROP\s+POLICY\b/i,
    /^\s*GRANT\b/im,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
    /\bDROP\s+FUNCTION\b/i,
    /(?<!NO )\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(migration)) {
      throw new Error(
        `Case activation candidate crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  if (
    count(migration, /^BEGIN;$/gm) !== 1
    || count(migration, /^COMMIT;$/gm) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" ENABLE ROW LEVEL SECURITY;$/gm,
    ) !== protectedTables.length
    || count(
      migration,
      /^ALTER TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)" NO FORCE ROW LEVEL SECURITY;$/gm,
    ) !== protectedTables.length
    || count(
      migration,
      /^REVOKE ALL ON TABLE public\."(?:Case|CaseMessage|CaseMessageAttachment)"$/gm,
    ) !== protectedTables.length
    || count(migration, /IF runtime_function_count <> 27/g) !== 1
    || count(migration, /IF accepted_table_count <> 3/g) !== 1
  ) {
    throw new Error("Case activation candidate catalog count drifted");
  }

  for (const table of protectedTables) {
    if (
      !migration.includes(
        `ALTER TABLE public."${table}" ENABLE ROW LEVEL SECURITY;`,
      )
      || !migration.includes(
        `ALTER TABLE public."${table}" NO FORCE ROW LEVEL SECURITY;`,
      )
      || !migration.includes(
        `REVOKE ALL ON TABLE public."${table}"\n  FROM PUBLIC, grainline_app_runtime;`,
      )
    ) {
      throw new Error(`Case activation candidate omitted ${table}`);
    }
  }

  return Object.freeze({
    migration,
    migrationSha256: sha256(migration),
  });
}

function assertDisposableTarget() {
  if (process.env.CASE_ACTIVATION_STAGING_ACK !== CASE_ACTIVATION_STAGING_ACK) {
    throw new Error("disposable Case activation acknowledgement is missing");
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error("DIRECT_URL is required for disposable Case activation staging");
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "Case activation migration may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths(rootDirectory = process.cwd()) {
  const directory = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    CASE_ACTIVATION_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration, rootDirectory = process.cwd()) {
  const { directory, migrationPath } = candidatePaths(rootDirectory);
  if (fs.existsSync(directory)) {
    throw new Error(`Case activation migration destination exists: ${directory}`);
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
    throw new Error("Case activation migration destination does not exist");
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error("refusing to remove drifted Case activation migration");
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-case-activation-migration.mjs "
      + "[--verify|--stage|--unstage]",
    );
  }
  const candidate = buildCaseActivationCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: CASE_ACTIVATION_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    protectedTables: protectedTables.length,
    rlsEnabled: true,
    rlsForced: false,
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
      `Case activation staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
