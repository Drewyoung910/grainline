#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CASE_READ_MODE_MIGRATION =
  "20260730020000_converge_case_read_modes";
export const CASE_READ_MODE_DRAFT =
  "docs/rls-drafts/case-case-message-read-mode.sql";
export const CASE_READ_MODE_DRAFT_SHA256 =
  "a0036ef86b4d92ce76d09dd0c799db83d3b7e192c9c4366aabd53ee070cdf973";
export const CASE_READ_MODE_STAGING_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_CASE_READ_MODE_STAGING";

const root = process.cwd();
const draftHeader =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const migrationHeader = [
  "-- Compatible Case recipient-projection read-mode convergence.",
  "-- RLS flags, policies, table grants and row data remain unchanged.",
].join("\n");
const expectedFunctions = Object.freeze([
  "grainline_case_get",
  "grainline_case_get_by_order",
  "grainline_case_staff_active_count",
  "grainline_case_export_page",
]);

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function buildCaseReadModeCandidate() {
  const draft = fs.readFileSync(
    path.join(root, CASE_READ_MODE_DRAFT),
    "utf8",
  );
  const draftSha256 = sha256(draft);
  if (draftSha256 !== CASE_READ_MODE_DRAFT_SHA256) {
    throw new Error(
      `${CASE_READ_MODE_DRAFT} byte pin drifted: expected `
      + `${CASE_READ_MODE_DRAFT_SHA256}, got ${draftSha256}`,
    );
  }
  if (!draft.startsWith(`${draftHeader}\n`)) {
    throw new Error("Case read-mode draft header is missing");
  }

  const migration = draft.replace(draftHeader, migrationHeader);
  const forbidden = [
    /DRAFT ONLY/,
    /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    /FORCE\s+ROW\s+LEVEL\s+SECURITY/i,
    /CREATE\s+POLICY\b/i,
    /(?:GRANT|REVOKE)[\s\S]{0,160}\bON\s+TABLE\s+public\."(?:Case|CaseMessage|CaseMessageAttachment)"/i,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
    /\bDROP\s+FUNCTION\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(migration)) {
      throw new Error(
        `Case read-mode candidate crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  const alteredFunctions = [
    ...migration.matchAll(
      /^ALTER FUNCTION public\.(grainline_[a-z0-9_]+)\(/gm,
    ),
  ].map((match) => match[1]);
  if (
    count(migration, /^BEGIN;$/gm) !== 1
    || count(migration, /^COMMIT;$/gm) !== 1
    || count(
      migration,
      /^ALTER FUNCTION public\.grainline_case_[a-z0-9_]+\(/gm,
    ) !== 4
    || count(
      migration,
      /^REVOKE ALL ON FUNCTION public\.grainline_case_[a-z0-9_]+\(/gm,
    ) !== 4
    || count(
      migration,
      /^GRANT EXECUTE ON FUNCTION public\.grainline_case_[a-z0-9_]+\(/gm,
    ) !== 4
    || alteredFunctions.join("\n") !== expectedFunctions.join("\n")
  ) {
    throw new Error("Case read-mode candidate catalog count drifted");
  }

  return Object.freeze({
    migration,
    migrationSha256: sha256(migration),
  });
}

function assertDisposableTarget() {
  if (
    process.env.CASE_READ_MODE_STAGING_ACK
      !== CASE_READ_MODE_STAGING_ACK
  ) {
    throw new Error("disposable Case read-mode acknowledgement is missing");
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error("DIRECT_URL is required for disposable read-mode staging");
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "Case read-mode migration may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths() {
  const directory = path.join(
    root,
    "prisma",
    "migrations",
    CASE_READ_MODE_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration) {
  const { directory, migrationPath } = candidatePaths();
  if (fs.existsSync(directory)) {
    throw new Error(`Case read-mode migration destination exists: ${directory}`);
  }
  fs.mkdirSync(directory, { recursive: false, mode: 0o700 });
  fs.writeFileSync(migrationPath, migration, {
    encoding: "utf8",
    mode: 0o600,
    flag: "wx",
  });
}

function unstageCandidate(migration) {
  const { directory, migrationPath } = candidatePaths();
  if (!fs.existsSync(directory)) {
    throw new Error("Case read-mode migration destination does not exist");
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error("refusing to remove drifted Case read-mode migration");
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-case-read-mode-migration.mjs "
      + "[--verify|--stage|--unstage]",
    );
  }
  const candidate = buildCaseReadModeCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: CASE_READ_MODE_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    functionModeChanges: 4,
    rlsChanged: false,
    policyCount: 0,
    tableGrantsChanged: false,
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
      `Case read-mode staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
