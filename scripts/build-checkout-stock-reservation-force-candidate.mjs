#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";
import {
  checkoutStockReservationSourceConsistentFunctionSourceMd5,
} from "./checkout-stock-reservation-function-source-catalog.mjs";

export const CHECKOUT_STOCK_RESERVATION_FORCE_MIGRATION =
  "20260815060001_force_checkout_stock_reservation_rls";
export const CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT =
  "docs/rls-drafts/checkout-stock-reservation-force.sql";
export const CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256 =
  "5f518087eeaa30c1580cb7522b8d61a6cecf263e4d5dc8c574492a7d8499b0cf";
export const CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256 =
  "cfa05295bd469903aa967919a0178312dbbc855203c408db2395602589f5178d";
export const CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT =
  "docs/rls-drafts/checkout-stock-reservation-force-rollback.sql";
export const CHECKOUT_STOCK_RESERVATION_FORCE_ROLLBACK_DRAFT_SHA256 =
  "e9de52772050a2e12d5d24294722ea5c76c9718d3bd13099e811bda02ed764ef";

const DRAFT_HEADER =
  "-- DRAFT ONLY. Do not apply to any persistent database.";
const MIGRATION_HEADER = [
  "-- Promoted reviewed posture-only CheckoutStockReservation FORCE hardening.",
  "-- Apply only through the separately reviewed guarded production workflow.",
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

export function buildCheckoutStockReservationForceCandidate(
  rootDirectory = process.cwd(),
) {
  const draft = readPinnedFile(
    rootDirectory,
    CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT,
    CHECKOUT_STOCK_RESERVATION_FORCE_DRAFT_SHA256,
  );
  readPinnedFile(
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
    || count(migration, /actual_function_count <> 25/g) !== 1
    || count(migration, /accepted_function_count <> 25/g) !== 1
    || count(migration, /named_runtime_function_count <> 16/g) !== 1
    || count(migration, /table_function_count <> 13/g) !== 1
  ) {
    throw new Error(
      "CheckoutStockReservation FORCE catalog or transaction count drifted",
    );
  }

  const compactMigration = migration.replace(/\s+/g, " ");
  const sourceMd5 = checkoutStockReservationSourceConsistentFunctionSourceMd5(
    rootDirectory,
  );
  for (const entry of CHECKOUT_STOCK_RESERVATION_ACTIVATED_FUNCTIONS) {
    const signature = `${entry.name}(${entry.argumentTypes})`;
    const expectedRow = `('${entry.name}', '${entry.argumentTypes}', '${sourceMd5[signature]}', ${entry.runtimeExecute}, '${entry.volatility}', '${entry.parallelSafety}', '${entry.language ?? "plpgsql"}')`;
    if (!compactMigration.includes(expectedRow)) {
      throw new Error(
        `CheckoutStockReservation FORCE omitted pinned function ${signature}`,
      );
    }
  }

  const migrationSha256 = sha256(migration);
  if (
    migrationSha256 !== CHECKOUT_STOCK_RESERVATION_FORCE_CANDIDATE_SHA256
  ) {
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
  if ((process.argv[2] ?? "--verify") !== "--verify") {
    throw new Error(
      "usage: build-checkout-stock-reservation-force-candidate.mjs --verify",
    );
  }
  const candidate = buildCheckoutStockReservationForceCandidate();
  process.stdout.write(`${JSON.stringify({
    mode: "--verify",
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    draftSha256: candidate.draftSha256,
    rollbackDraftSha256: candidate.rollbackDraftSha256,
    protectedTables: 1,
    runtimeFunctions: 16,
    privateFunctions: 9,
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
