#!/usr/bin/env node
import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS,
  sellerPayoutEventAuthorityFunctionSources,
} from "./verify-seller-payout-event-authority-production-scope.mjs";

export const SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION =
  "20260822180000_enable_seller_payout_event_rls";
export const SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT =
  "docs/rls-drafts/seller-payout-event-activation.sql";
export const SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT_SHA256 =
  "04bed329e4ab1dc4b0f575f672ef6d52e301aba6e4946e1fbfe355134efd5c51";
export const SELLER_PAYOUT_EVENT_ACTIVATION_STAGING_ACK =
  "I_ACKNOWLEDGE_LOOPBACK_SELLER_PAYOUT_EVENT_ACTIVATION_STAGING";

const draftHeader =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const migrationHeader = [
  "-- Promoted reviewed policyless SellerPayoutEvent ENABLE activation.",
  "-- FORCE RLS remains off for the later posture-only hardening release.",
].join("\n");

function digest(algorithm, value) {
  return createHash(algorithm).update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

export function sellerPayoutEventAuthorityFunctionSourceMd5(
  rootDirectory = process.cwd(),
) {
  return Object.freeze(Object.fromEntries(
    Object.entries(sellerPayoutEventAuthorityFunctionSources(rootDirectory))
      .map(([identity, source]) => [identity, digest("md5", source)]),
  ));
}

export function buildSellerPayoutEventActivationCandidate(
  rootDirectory = process.cwd(),
) {
  const draft = fs.readFileSync(
    path.join(rootDirectory, SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT),
    "utf8",
  );
  const draftSha256 = digest("sha256", draft);
  if (draftSha256 !== SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT_SHA256) {
    throw new Error(
      `${SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT} byte pin drifted: expected `
      + `${SELLER_PAYOUT_EVENT_ACTIVATION_DRAFT_SHA256}, got ${draftSha256}`,
    );
  }
  if (!draft.startsWith(`${draftHeader}\n`)) {
    throw new Error("SellerPayoutEvent activation draft header is missing");
  }

  const migration = draft.replace(draftHeader, migrationHeader);
  const forbidden = [
    /DRAFT ONLY/u,
    /\bCREATE\s+POLICY\b/iu,
    /\bDROP\s+POLICY\b/iu,
    /^\s*GRANT\b/imu,
    /^\s*(?:INSERT\s+INTO|UPDATE\s+public\.|DELETE\s+FROM|TRUNCATE)\b/imu,
    /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\b/iu,
    /\bDROP\s+FUNCTION\b/iu,
    /(?<!NO )\bFORCE\s+ROW\s+LEVEL\s+SECURITY\b/iu,
  ];
  for (const pattern of forbidden) {
    if (pattern.test(migration)) {
      throw new Error(
        `SellerPayoutEvent activation crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  if (
    count(migration, /^BEGIN;$/gmu) !== 1
    || count(migration, /^COMMIT;$/gmu) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."SellerPayoutEvent" ENABLE ROW LEVEL SECURITY;$/gmu,
    ) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."SellerPayoutEvent" NO FORCE ROW LEVEL SECURITY;$/gmu,
    ) !== 1
    || count(
      migration,
      /^REVOKE ALL ON TABLE public\."SellerPayoutEvent"$/gmu,
    ) !== 1
    || count(
      migration,
      /ALTER COLUMN "stripeEventCreatedSeconds" SET NOT NULL;/gu,
    ) !== 1
    || count(migration, /IF function_count <> 3/gu) !== 1
    || count(migration, /IF named_runtime_function_count <> 3/gu) !== 1
    || count(migration, /IF table_function_count <> 3/gu) !== 1
    || count(migration, /IF accepted_table_count <> 1/gu) !== 1
    || count(
      migration,
      /pg_catalog\.md5\(procedure\.prosrc\) = expected\.source_md5/gu,
    ) !== 1
  ) {
    throw new Error("SellerPayoutEvent activation catalog count drifted");
  }

  const compactMigration = migration.replace(/\s+/gu, " ");
  const sourceMd5 = sellerPayoutEventAuthorityFunctionSourceMd5(rootDirectory);
  for (const entry of SELLER_PAYOUT_EVENT_AUTHORITY_FUNCTIONS) {
    const splitAt = entry.identity.indexOf("(");
    const functionName = entry.identity.slice(0, splitAt);
    const identityArguments = entry.identity.slice(splitAt + 1, -1)
      .replaceAll(",", ", ");
    const signature = `'${functionName}', '${identityArguments}'`;
    if (
      !compactMigration.includes(signature)
      || !compactMigration.includes(`'${sourceMd5[entry.identity]}'`)
    ) {
      throw new Error(
        `SellerPayoutEvent activation omitted pinned function ${entry.identity}`,
      );
    }
  }

  return Object.freeze({
    migration,
    migrationSha256: digest("sha256", migration),
  });
}

function assertDisposableTarget() {
  if (
    process.env.SELLER_PAYOUT_EVENT_ACTIVATION_STAGING_ACK
      !== SELLER_PAYOUT_EVENT_ACTIVATION_STAGING_ACK
  ) {
    throw new Error(
      "disposable SellerPayoutEvent activation acknowledgement is missing",
    );
  }
  const rawUrl = process.env.DIRECT_URL;
  if (!rawUrl) {
    throw new Error(
      "DIRECT_URL is required for disposable SellerPayoutEvent activation staging",
    );
  }
  const parsed = new URL(rawUrl);
  if (
    !["localhost", "127.0.0.1", "::1"].includes(parsed.hostname)
    || parsed.pathname !== "/grainline_ci"
  ) {
    throw new Error(
      "SellerPayoutEvent activation may be staged only for loopback grainline_ci",
    );
  }
}

function candidatePaths(rootDirectory = process.cwd()) {
  const directory = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
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
      `SellerPayoutEvent activation destination exists: ${directory}`,
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
      "SellerPayoutEvent activation destination does not exist",
    );
  }
  const entries = fs.readdirSync(directory);
  if (
    entries.length !== 1
    || entries[0] !== "migration.sql"
    || !fs.statSync(migrationPath).isFile()
    || digest("sha256", fs.readFileSync(migrationPath, "utf8"))
      !== digest("sha256", migration)
  ) {
    throw new Error(
      "refusing to remove drifted SellerPayoutEvent activation migration",
    );
  }
  fs.unlinkSync(migrationPath);
  fs.rmdirSync(directory);
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--stage", "--unstage"]).has(mode)) {
    throw new Error(
      "usage: stage-seller-payout-event-activation-migration.mjs "
      + "[--verify|--stage|--unstage]",
    );
  }
  const candidate = buildSellerPayoutEventActivationCandidate();
  if (mode !== "--verify") assertDisposableTarget();
  if (mode === "--stage") stageCandidate(candidate.migration);
  if (mode === "--unstage") unstageCandidate(candidate.migration);
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
    migrationSha256: candidate.migrationSha256,
    protectedTables: 1,
    runtimeFunctions: 3,
    rlsEnabled: true,
    rlsForced: false,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    providerEventTimeNotNull: true,
    rowDataChanged: false,
    productionChanged: false,
    persistentStagingChanged: mode === "--stage",
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `SellerPayoutEvent activation staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
