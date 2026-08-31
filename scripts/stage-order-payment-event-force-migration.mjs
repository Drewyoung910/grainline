#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const ORDER_PAYMENT_EVENT_FORCE_MIGRATION =
  "20260831010000_force_order_payment_event_rls";
export const ORDER_PAYMENT_EVENT_FORCE_DRAFT =
  "docs/rls-drafts/order-payment-event-force.sql";
export const ORDER_PAYMENT_EVENT_FORCE_DRAFT_SHA256 =
  "ede67764c0fa9cde5c694325e6303dd9a88cc10bdc7cfa4825ca69baa50044ab";
export const ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256 =
  "20d590b14f8b2dd5ee22537b18138624292bbfe8de8b3e5f2d407fae02f606cd";
export const ORDER_PAYMENT_EVENT_FORCE_ROLLBACK_DRAFT =
  "docs/rls-drafts/order-payment-event-force-rollback.sql";
export const ORDER_PAYMENT_EVENT_FORCE_ROLLBACK_SHA256 =
  "2c226a22522e6a2259286f4567060625ecb3caf346b1144122194651a232a999";
export const ORDER_PAYMENT_EVENT_FORCE_STAGING_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_ORDER_PAYMENT_EVENT_FORCE_STAGING";

const draftHeader =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const migrationHeader = [
  "-- Reviewed posture-only OrderPaymentEvent FORCE hardening.",
  "-- Apply only through the guarded main-only production migration workflow.",
].join("\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function buildOrderPaymentEventForceCandidate(
  rootDirectory = process.cwd(),
) {
  const draft = fs.readFileSync(
    path.join(rootDirectory, ORDER_PAYMENT_EVENT_FORCE_DRAFT),
    "utf8",
  );
  const draftSha256 = sha256(draft);
  if (draftSha256 !== ORDER_PAYMENT_EVENT_FORCE_DRAFT_SHA256) {
    throw new Error(
      `${ORDER_PAYMENT_EVENT_FORCE_DRAFT} byte pin drifted: expected `
      + `${ORDER_PAYMENT_EVENT_FORCE_DRAFT_SHA256}, got ${draftSha256}`,
    );
  }
  if (!draft.startsWith(`${draftHeader}\n`)) {
    throw new Error("OrderPaymentEvent FORCE draft header is missing");
  }

  const migration = draft.replace(draftHeader, migrationHeader);
  const forbidden = [
    /DRAFT ONLY/u,
    /\bCREATE\s+POLICY\b/iu,
    /\bDROP\s+POLICY\b/iu,
    /^\s*(?:GRANT|REVOKE)\b/imu,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/imu,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/iu,
    /\bDROP\s+FUNCTION\b/iu,
    /\bNO\s+FORCE\s+ROW\s+LEVEL\s+SECURITY\b/iu,
    /\b(?:ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/iu,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(migration)) {
      throw new Error(
        `OrderPaymentEvent FORCE candidate crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  if (
    count(migration, /^BEGIN;$/gmu) !== 1
    || count(migration, /^COMMIT;$/gmu) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."OrderPaymentEvent" FORCE ROW LEVEL SECURITY;$/gmu,
    ) !== 1
    || count(migration, /IF accepted_table_count <> 1/gu) !== 2
    || count(migration, /IF function_count <> 29/gu) !== 2
    || count(migration, /IF named_function_count <> 29/gu) !== 2
    || count(migration, /IF direct_function_count <> 25/gu) !== 1
  ) {
    throw new Error("OrderPaymentEvent FORCE candidate catalog count drifted");
  }

  const migrationSha256 = sha256(migration);
  if (migrationSha256 !== ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256) {
    throw new Error(
      "OrderPaymentEvent FORCE promoted migration byte pin drifted",
    );
  }
  const rollbackDraft = fs.readFileSync(
    path.join(rootDirectory, ORDER_PAYMENT_EVENT_FORCE_ROLLBACK_DRAFT),
    "utf8",
  );
  const rollbackDraftSha256 = sha256(rollbackDraft);
  if (rollbackDraftSha256 !== ORDER_PAYMENT_EVENT_FORCE_ROLLBACK_SHA256) {
    throw new Error(
      "OrderPaymentEvent FORCE rollback draft byte pin drifted",
    );
  }

  return Object.freeze({
    migration,
    migrationSha256,
    rollbackDraftSha256,
  });
}

function assertDisposableTarget() {
  if (
    process.env.ORDER_PAYMENT_EVENT_FORCE_STAGING_ACK
      !== ORDER_PAYMENT_EVENT_FORCE_STAGING_ACK
  ) {
    throw new Error("disposable OrderPaymentEvent FORCE acknowledgement is missing");
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
      "OrderPaymentEvent FORCE migration may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths(rootDirectory = process.cwd()) {
  const directory = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  );
  return Object.freeze({
    directory,
    migrationPath: path.join(directory, "migration.sql"),
  });
}

function stageCandidate(migration, rootDirectory = process.cwd()) {
  const { directory, migrationPath } = candidatePaths(rootDirectory);
  if (fs.existsSync(directory)) {
    throw new Error(`OrderPaymentEvent FORCE destination exists: ${directory}`);
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
    throw new Error("OrderPaymentEvent FORCE destination does not exist");
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || sha256(fs.readFileSync(migrationPath, "utf8")) !== sha256(migration)
  ) {
    throw new Error("refusing to remove drifted OrderPaymentEvent FORCE migration");
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!["--verify", "--stage", "--unstage"].includes(mode)) {
    throw new Error(
      "usage: stage-order-payment-event-force-migration.mjs "
      + "[--verify|--stage|--unstage]",
    );
  }
  const candidate = buildOrderPaymentEventForceCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
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
      `OrderPaymentEvent FORCE staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
