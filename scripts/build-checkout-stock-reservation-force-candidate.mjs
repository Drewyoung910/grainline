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

export const CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION =
  "20260811020000_force_checkout_stock_reservation_rls";
export const CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT =
  "docs/rls-drafts/checkout-stock-reservation-force.sql";
export const CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256 =
  "e09dc1167aa8f98c8c7196af615368b2985e234d6cf17914b186c21003b2aa61";
export const CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256 =
  "e182872ccfa8f2537e28f150cc535464d38affb6e8365d2a48d5b3c8f869bfeb";
export const CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT =
  "docs/rls-drafts/checkout-stock-reservation-force-rollback.sql";
export const CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT_SHA256 =
  "b1120c068044d33e8993938cc78ba32a2cf04e4d96d7cae37f0940ecc43a390c";

const DRAFT_HEADER =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const MIGRATION_HEADER = [
  "-- Reviewed posture-only CheckoutStockReservation FORCE hardening.",
  "-- Apply only through a separately reviewed guarded production release.",
].join("\n");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function count(source, pattern) {
  return (source.match(pattern) ?? []).length;
}

function readPinned(rootDirectory, relativePath, expectedSha256) {
  const source = fs.readFileSync(path.join(rootDirectory, relativePath), "utf8");
  const actualSha256 = sha256(source);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `${relativePath} byte pin drifted: expected ${expectedSha256}, got ${actualSha256}`,
    );
  }
  return source;
}

export function buildCheckoutStockReservationForceCandidate(
  rootDirectory = process.cwd(),
) {
  const draft = readPinned(
    rootDirectory,
    CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT,
    CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256,
  );
  readPinned(
    rootDirectory,
    CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT,
    CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT_SHA256,
  );
  if (!draft.startsWith(`${DRAFT_HEADER}\n`)) {
    throw new Error("CheckoutStockReservation FORCE draft header is missing");
  }

  const migration = draft.replace(DRAFT_HEADER, MIGRATION_HEADER);
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
        `CheckoutStockReservation FORCE crossed its reviewed boundary: ${pattern}`,
      );
    }
  }

  if (
    count(migration, /^BEGIN;$/gm) !== 1
    || count(migration, /^COMMIT;$/gm) !== 1
    || count(
      migration,
      /^ALTER TABLE public\."CheckoutStockReservation" FORCE ROW LEVEL SECURITY;$/gm,
    ) !== 1
    || count(migration, /accepted_table_count <> 1/g) !== 2
    || count(migration, /actual_function_count <> 20/g) !== 1
    || count(migration, /accepted_function_count <> 20/g) !== 1
  ) {
    throw new Error(
      "CheckoutStockReservation FORCE catalog or transaction count drifted",
    );
  }

  const compactMigration = migration.replace(/\s+/g, " ");
  const sourceMd5 = checkoutStockReservationFunctionSourceMd5(rootDirectory);
  for (const entry of CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS) {
    const signature = `${entry.name}(${entry.argumentTypes})`;
    const expectedRow = `('${entry.name}', '${entry.argumentTypes}', '${sourceMd5[signature]}', ${entry.runtimeExecute}, '${entry.volatility}', '${entry.parallelSafety}')`;
    if (!compactMigration.includes(expectedRow)) {
      throw new Error(
        `CheckoutStockReservation FORCE omitted pinned function ${signature}`,
      );
    }
  }

  const migrationSha256 = sha256(migration);
  if (migrationSha256 !== CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256) {
    throw new Error("CheckoutStockReservation FORCE candidate bytes drifted");
  }

  return Object.freeze({
    migration,
    migrationName: CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION,
    migrationSha256,
    draftSha256: CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256,
    rollbackDraftSha256:
      CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT_SHA256,
  });
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (mode !== "--verify") {
    throw new Error(
      "usage: build-checkout-stock-reservation-force-candidate.mjs --verify",
    );
  }
  const candidate = buildCheckoutStockReservationForceCandidate();
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
    rlsForced: true,
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
      `CheckoutStockReservation FORCE candidate verification failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
