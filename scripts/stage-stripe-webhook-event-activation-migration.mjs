#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS,
  stripeWebhookEventFunctionSourceMd5,
} from "./stripe-webhook-event-function-source-catalog.mjs";

export const STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION =
  "20260805060000_enable_stripe_webhook_event_rls";
export const STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT =
  "docs/rls-drafts/stripe-webhook-event-activation.sql";
export const STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256 =
  "af47ed86b90276b0285618b7751c27a15fc52bd0a1a7bcc279c959e05c37e88b";
export const STRIPE_WEBHOOK_EVENT_ACTIVATION_STAGING_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_STRIPE_WEBHOOK_EVENT_ACTIVATION_STAGING";

const draftHeader =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const migrationHeader = [
  "-- Promoted reviewed policyless StripeWebhookEvent ENABLE activation.",
  "-- FORCE RLS remains off for the later posture-only hardening release.",
].join("\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function buildStripeWebhookEventActivationCandidate(
  rootDirectory = process.cwd(),
) {
  const draft = fs.readFileSync(
    path.join(rootDirectory, STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT),
    "utf8",
  );
  const draftSha256 = sha256(draft);
  if (draftSha256 !== STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256) {
    throw new Error(
      `${STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT} byte pin drifted: expected `
      + `${STRIPE_WEBHOOK_EVENT_ACTIVATION_DRAFT_SHA256}, got ${draftSha256}`,
    );
  }
  if (!draft.startsWith(`${draftHeader}\n`)) {
    throw new Error("StripeWebhookEvent activation draft header is missing");
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
        `StripeWebhookEvent activation crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  if (
    count(migration, /^BEGIN;$/gm) !== 1
    || count(migration, /^COMMIT;$/gm) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."StripeWebhookEvent" ENABLE ROW LEVEL SECURITY;$/gm,
    ) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."StripeWebhookEvent" NO FORCE ROW LEVEL SECURITY;$/gm,
    ) !== 1
    || count(
      migration,
      /^REVOKE ALL ON TABLE public\."StripeWebhookEvent"$/gm,
    ) !== 1
    || count(migration, /IF function_count <> 6/g) !== 1
    || count(migration, /IF named_runtime_function_count <> 6/g) !== 1
    || count(migration, /IF table_function_count <> 6/g) !== 1
    || count(migration, /IF accepted_table_count <> 1/g) !== 1
    || count(
      migration,
      /pg_catalog\.md5\(procedure\.prosrc\) = expected\.source_md5/g,
    ) !== 1
  ) {
    throw new Error("StripeWebhookEvent activation catalog count drifted");
  }

  const compactMigration = migration.replace(/\s+/g, " ");
  const sourceMd5 = stripeWebhookEventFunctionSourceMd5(rootDirectory, {
    throughMigration: STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
  });
  for (const entry of STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS) {
    const signature = `'${entry.name}', '${entry.identityArguments}', '${sourceMd5[entry.name]}'`;
    if (!compactMigration.includes(signature)) {
      throw new Error(
        `StripeWebhookEvent activation omitted pinned function ${entry.name}`,
      );
    }
  }

  return Object.freeze({
    migration,
    migrationSha256: sha256(migration),
  });
}

function assertDisposableTarget() {
  if (
    process.env.STRIPE_WEBHOOK_EVENT_ACTIVATION_STAGING_ACK
      !== STRIPE_WEBHOOK_EVENT_ACTIVATION_STAGING_ACK
  ) {
    throw new Error(
      "disposable StripeWebhookEvent activation acknowledgement is missing",
    );
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error(
      "DIRECT_URL is required for disposable StripeWebhookEvent activation staging",
    );
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "StripeWebhookEvent activation may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths(rootDirectory = process.cwd()) {
  const directory = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration, rootDirectory = process.cwd()) {
  const { directory, migrationPath } = candidatePaths(rootDirectory);
  if (fs.existsSync(directory)) {
    throw new Error(
      `StripeWebhookEvent activation destination exists: ${directory}`,
    );
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
    throw new Error(
      "StripeWebhookEvent activation destination does not exist",
    );
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error(
      "refusing to remove drifted StripeWebhookEvent activation migration",
    );
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-stripe-webhook-event-activation-migration.mjs "
      + "[--verify|--stage|--unstage]",
    );
  }
  const candidate = buildStripeWebhookEventActivationCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    protectedTables: 1,
    runtimeFunctions: 6,
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
      `StripeWebhookEvent activation staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
