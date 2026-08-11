#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";
import {
  checkoutStockReservationFunctionSourceMd5,
} from "./checkout-stock-reservation-function-source-catalog.mjs";

export const CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION =
  "20260810220000_enable_checkout_stock_reservation_rls";
export const CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT =
  "docs/rls-drafts/checkout-stock-reservation-activation.sql";
export const CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT_SHA256 =
  "5cb684828519b86244c9abb7eff86d47ac9b9dc969843fafb57f243d110ceea7";
export const CHECKOUT_STOCK_RESERVATION_ACTIVATION_CANDIDATE_SHA256 =
  "5d82078eaccc8face126587de7610834d4d578ddf27d78d9f4a3fa31b07127c0";
export const CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT =
  "docs/rls-drafts/checkout-stock-reservation-activation-rollback.sql";
export const CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT_SHA256 =
  "48234ae984845e5bce6aef3463d6b2b30a4ebd763721806b8f40cf58b4acf0cd";

const DRAFT_HEADER =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const MIGRATION_HEADER = [
  "-- Promoted reviewed policyless CheckoutStockReservation ENABLE activation.",
  "-- FORCE RLS remains a separate later posture-only release.",
].join("\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

function readPinnedFile(rootDirectory, relativePath, expectedSha256) {
  const source = fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
  const actualSha256 = sha256(source);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${relativePath} byte pin drifted: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  return source;
}

export function buildCheckoutStockReservationActivationCandidate(
  rootDirectory = process.cwd(),
) {
  const draft = readPinnedFile(
    rootDirectory,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT_SHA256,
  );
  readPinnedFile(
    rootDirectory,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT,
    CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT_SHA256,
  );
  if (!draft.startsWith(`${DRAFT_HEADER}\n`)) {
    throw new Error("CheckoutStockReservation activation draft header is missing");
  }

  const migration = draft.replace(DRAFT_HEADER, MIGRATION_HEADER);
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
        `CheckoutStockReservation activation crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  if (
    count(migration, /^BEGIN;$/gm) !== 1
    || count(migration, /^COMMIT;$/gm) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."CheckoutStockReservation" ENABLE ROW LEVEL SECURITY;$/gm,
    ) !== 1
    || count(
      migration,
      /^REVOKE ALL ON TABLE public\."CheckoutStockReservation"$/gm,
    ) !== 1
    || count(migration, /actual_function_count <> 20/g) !== 1
    || count(migration, /accepted_function_count <> 20/g) !== 1
    || count(migration, /actual_constraint_count <> 5/g) !== 1
    || count(migration, /accepted_constraint_count <> 5/g) !== 1
    || count(migration, /actual_index_count <> 9/g) !== 1
    || count(migration, /accepted_index_count <> 9/g) !== 1
    || count(migration, /actual_trigger_count <> 1/g) !== 1
    || count(migration, /normalize_trigger_count <> 1/g) !== 1
    || count(migration, /accepted_table_count <> 1/g) !== 1
  ) {
    throw new Error(
      "CheckoutStockReservation activation catalog or transaction count drifted",
    );
  }

  const compactMigration = migration.replace(/\s+/g, " ");
  const sourceMd5 = checkoutStockReservationFunctionSourceMd5(rootDirectory);
  for (const entry of CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS) {
    const signature = `${entry.name}(${entry.argumentTypes})`;
    const expectedRow = `('${entry.name}', '${entry.argumentTypes}', '${sourceMd5[signature]}', ${entry.runtimeExecute}, '${entry.volatility}', '${entry.parallelSafety}')`;
    if (!compactMigration.includes(expectedRow)) {
      throw new Error(
        `CheckoutStockReservation activation omitted pinned function ${signature}`,
      );
    }
  }

  const migrationSha256 = sha256(migration);
  if (
    migrationSha256
    !== CHECKOUT_STOCK_RESERVATION_ACTIVATION_CANDIDATE_SHA256
  ) {
    throw new Error(
      "CheckoutStockReservation activation candidate bytes drifted",
    );
  }

  return Object.freeze({
    migration,
    migrationName: CHECKOUT_STOCK_RESERVATION_ACTIVATION_MIGRATION,
    migrationSha256,
    draftSha256: CHECKOUT_STOCK_RESERVATION_ACTIVATION_DRAFT_SHA256,
    rollbackDraftSha256:
      CHECKOUT_STOCK_RESERVATION_ACTIVATION_ROLLBACK_DRAFT_SHA256,
  });
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (mode !== "--verify") {
    throw new Error(
      "usage: build-checkout-stock-reservation-activation-candidate.mjs --verify",
    );
  }
  const candidate = buildCheckoutStockReservationActivationCandidate();
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    draftSha256: candidate.draftSha256,
    rollbackDraftSha256: candidate.rollbackDraftSha256,
    protectedTables: 1,
    runtimeFunctions: 16,
    privateFunctions: 4,
    rlsEnabled: true,
    rlsForced: false,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    rowDataChanged: false,
    migrationDirectoryCreated: false,
    productionChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `CheckoutStockReservation activation candidate verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
