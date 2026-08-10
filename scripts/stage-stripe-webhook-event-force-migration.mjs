#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION =
  "20260810172000_force_stripe_webhook_event_rls";
export const STRIPE_WEBHOOK_EVENT_FORCE_DRAFT =
  "docs/rls-drafts/stripe-webhook-event-force.sql";
export const STRIPE_WEBHOOK_EVENT_FORCE_DRAFT_SHA256 =
  "eeb9f8cc287b0b9c7302684bfab02d74eaa82d5851018d08c4129ab65f92a90f";
export const STRIPE_WEBHOOK_EVENT_FORCE_STAGING_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_STRIPE_WEBHOOK_EVENT_FORCE_STAGING";

const draftHeader =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const migrationHeader = [
  "-- Reviewed posture-only StripeWebhookEvent FORCE hardening.",
  "-- Apply only through the guarded main-only production migration workflow.",
].join("\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function buildStripeWebhookEventForceCandidate(
  rootDirectory = process.cwd(),
) {
  const draft = fs.readFileSync(
    path.join(rootDirectory, STRIPE_WEBHOOK_EVENT_FORCE_DRAFT),
    "utf8",
  );
  const draftSha256 = sha256(draft);
  if (draftSha256 !== STRIPE_WEBHOOK_EVENT_FORCE_DRAFT_SHA256) {
    throw new Error(
      `${STRIPE_WEBHOOK_EVENT_FORCE_DRAFT} byte pin drifted: expected `
      + `${STRIPE_WEBHOOK_EVENT_FORCE_DRAFT_SHA256}, got ${draftSha256}`,
    );
  }
  if (!draft.startsWith(`${draftHeader}\n`)) {
    throw new Error("StripeWebhookEvent FORCE draft header is missing");
  }

  const migration = draft.replace(draftHeader, migrationHeader);
  const forbidden = [
    /DRAFT ONLY/,
    /\bCREATE\s+POLICY\b/i,
    /\bDROP\s+POLICY\b/i,
    /^\s*(?:GRANT|REVOKE)\b/im,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/im,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/i,
    /\bDROP\s+FUNCTION\b/i,
    /\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/i,
    /\b(?:ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(migration)) {
      throw new Error(
        `StripeWebhookEvent FORCE candidate crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  if (
    count(migration, /^BEGIN;$/gm) !== 1
    || count(migration, /^COMMIT;$/gm) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."StripeWebhookEvent" FORCE ROW LEVEL SECURITY;$/gm,
    ) !== 1
    || count(migration, /IF accepted_table_count <> 1/g) !== 2
    || count(migration, /IF accepted_function_count <> 6/g) !== 1
    || count(migration, /IF named_runtime_function_count <> 6/g) !== 1
    || count(migration, /IF table_function_count <> 6/g) !== 1
  ) {
    throw new Error("StripeWebhookEvent FORCE candidate catalog count drifted");
  }

  return Object.freeze({
    migration,
    migrationSha256: sha256(migration),
  });
}

function assertDisposableTarget() {
  if (
    process.env.STRIPE_WEBHOOK_EVENT_FORCE_STAGING_ACK
      !== STRIPE_WEBHOOK_EVENT_FORCE_STAGING_ACK
  ) {
    throw new Error("disposable StripeWebhookEvent FORCE acknowledgement is missing");
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error("DIRECT_URL is required for disposable FORCE staging");
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "StripeWebhookEvent FORCE migration may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths(rootDirectory = process.cwd()) {
  const directory = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration, rootDirectory = process.cwd()) {
  const { directory, migrationPath } = candidatePaths(rootDirectory);
  if (fs.existsSync(directory)) {
    throw new Error(`StripeWebhookEvent FORCE destination exists: ${directory}`);
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
    throw new Error("StripeWebhookEvent FORCE destination does not exist");
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error("refusing to remove drifted StripeWebhookEvent FORCE migration");
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!["--verify", "--stage", "--unstage"].includes(mode)) {
    throw new Error(
      "usage: stage-stripe-webhook-event-force-migration.mjs "
      + "[--verify|--stage|--unstage]",
    );
  }
  const candidate = buildStripeWebhookEventForceCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    protectedTables: 1,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    rowDataChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `StripeWebhookEvent FORCE staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
