#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CASE_INVARIANT_MIGRATION =
  "20260730010000_enforce_case_message_invariants";
export const CASE_INVARIANT_DRAFT =
  "docs/rls-drafts/case-case-message-invariants.sql";
export const CASE_INVARIANT_DRAFT_SHA256 =
  "08d635abe68a2a3b0bd926989d579ad3f339825ac7a33508085e1d792b259393";
export const CASE_INVARIANT_STAGING_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_CASE_INVARIANT_STAGING";

const root = process.cwd();
const draftHeader =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const migrationHeader = [
  "-- Durable Case, CaseMessage and CaseMessageAttachment invariants.",
  "-- RLS, policies and table-grant changes remain intentionally absent.",
].join("\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function buildCaseInvariantCandidate() {
  const draft = fs.readFileSync(
    path.join(root, CASE_INVARIANT_DRAFT),
    "utf8",
  );
  const draftSha256 = sha256(draft);
  if (draftSha256 !== CASE_INVARIANT_DRAFT_SHA256) {
    throw new Error(
      `${CASE_INVARIANT_DRAFT} byte pin drifted: expected `
      + `${CASE_INVARIANT_DRAFT_SHA256}, got ${draftSha256}`,
    );
  }
  if (!draft.startsWith(`${draftHeader}\n`)) {
    throw new Error("Case invariant draft header is missing");
  }

  const migration = draft.replace(draftHeader, migrationHeader);
  const forbidden = [
    /DRAFT ONLY/,
    /ENABLE\s+ROW\s+LEVEL\s+SECURITY/i,
    /FORCE\s+ROW\s+LEVEL\s+SECURITY/i,
    /CREATE\s+POLICY\b/i,
    /(?:GRANT|REVOKE)[\s\S]{0,160}\bON\s+TABLE\s+public\."(?:Case|CaseMessage|CaseMessageAttachment)"/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(migration)) {
      throw new Error(
        `Case invariant candidate crossed its reviewed boundary: ${pattern}`,
      );
    }
  }
  if (
    count(migration, /^BEGIN;$/gm) !== 1
    || count(migration, /^COMMIT;$/gm) !== 1
    || count(migration, /^CREATE FUNCTION/gm) !== 8
    || count(migration, /^CREATE (?:CONSTRAINT )?TRIGGER/gm) !== 9
    || count(migration, /\bADD CONSTRAINT\b/g) !== 6
    || count(migration, /\bVALIDATE CONSTRAINT\b/g) !== 6
  ) {
    throw new Error("Case invariant candidate catalog count drifted");
  }

  return Object.freeze({
    migration,
    migrationSha256: sha256(migration),
  });
}

function assertDisposableTarget() {
  if (
    process.env.CASE_INVARIANT_STAGING_ACK
      !== CASE_INVARIANT_STAGING_ACK
  ) {
    throw new Error("disposable Case invariant acknowledgement is missing");
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error("DIRECT_URL is required for disposable invariant staging");
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "Case invariant migration may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths() {
  const directory = path.join(
    root,
    "prisma",
    "migrations",
    CASE_INVARIANT_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration) {
  const { directory, migrationPath } = candidatePaths();
  if (fs.existsSync(directory)) {
    throw new Error(`Case invariant migration destination exists: ${directory}`);
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
    throw new Error("Case invariant migration destination does not exist");
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error("refusing to remove drifted Case invariant migration");
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-case-invariant-migration.mjs "
      + "[--verify|--stage|--unstage]",
    );
  }
  const candidate = buildCaseInvariantCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: CASE_INVARIANT_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    functionCount: 8,
    triggerCount: 9,
    constraintCount: 6,
    rlsChanged: false,
    policyCount: 0,
    tableGrantsChanged: false,
    productionChanged: false,
    persistentStagingChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `Case invariant staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
