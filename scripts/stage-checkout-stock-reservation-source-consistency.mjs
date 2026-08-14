#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION =
  "20260814053000_prepare_checkout_stock_reservation_source_consistency";
export const CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_DRAFT =
  "docs/rls-drafts/checkout-stock-reservation-source-consistency.sql";
export const CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_DRAFT_SHA256 =
  "863a731c1e0651f8a91c38f1b614f2a92fc5edd7eb741929aa5a223a71b75bd2";
export const CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION_SHA256 =
  "69623f2363c6ae4978ff2cc8a22ccc1b8d9f43d378e01678c2fc6ef6f14b9928";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function readPinnedDraft(rootDirectory) {
  const draftPath = path.join(
    rootDirectory,
    CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_DRAFT,
  );
  const source = fs.readFileSync(draftPath, "utf8");
  if (sha256(source) !== CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_DRAFT_SHA256) {
    throw new Error("CheckoutStockReservation source-consistency draft bytes drifted");
  }
  if (/^\s*(?:BEGIN|COMMIT);/mi.test(source)) {
    throw new Error("CheckoutStockReservation source-consistency draft contains transaction boundaries");
  }
  if (
    !source.includes("grainline_checkout_reservation_create_cart_consistent")
    || !source.includes("grainline_checkout_reservation_create_single_consistent")
    || !source.includes("Checkout source witness changed")
  ) {
    throw new Error("CheckoutStockReservation source-consistency draft lost its reviewed authority shape");
  }
  return source;
}

export function buildCheckoutStockReservationSourceConsistencyCandidate(
  rootDirectory = process.cwd(),
) {
  const body = readPinnedDraft(rootDirectory);
  const migration = `-- Additive CheckoutStockReservation source-consistency authority.
--
-- The exact provider-proven wrappers derive and lock the complete Stripe-bound
-- source in one database statement. This is DB-first compatibility work: it
-- does not enable RLS, revoke predecessor authority, or mutate existing rows.

BEGIN;

${body}
COMMIT;
`;

  if (/ALTER TABLE public\."CheckoutStockReservation"\s+(?:ENABLE|FORCE) ROW LEVEL SECURITY/iu.test(migration)) {
    throw new Error("source-consistency candidate must not activate RLS");
  }
  if (/(?:GRANT|REVOKE)[\s\S]{0,120}ON TABLE public\."CheckoutStockReservation"/iu.test(migration)) {
    throw new Error("source-consistency candidate must preserve predecessor table grants");
  }
  if (/\b(?:DELETE|UPDATE)\s+(?:FROM\s+)?public\."CheckoutStockReservation"/iu.test(body)) {
    throw new Error("source-consistency candidate must not rewrite reservation rows during installation");
  }

  const migrationSha256 = sha256(migration);
  if (
    migrationSha256
    !== CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION_SHA256
  ) {
    throw new Error("source-consistency migration wrapper bytes drifted");
  }

  return Object.freeze({
    draftSha256: CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_DRAFT_SHA256,
    migration,
    migrationName: CHECKOUT_STOCK_RESERVATION_SOURCE_CONSISTENCY_MIGRATION,
    migrationSha256,
  });
}

export function verifyPromotedCheckoutStockReservationSourceConsistency(
  rootDirectory = process.cwd(),
) {
  const candidate = buildCheckoutStockReservationSourceConsistencyCandidate(rootDirectory);
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    candidate.migrationName,
    "migration.sql",
  );
  if (!fs.existsSync(migrationPath)) {
    throw new Error("promoted CheckoutStockReservation source-consistency migration is missing");
  }
  if (fs.readFileSync(migrationPath, "utf8") !== candidate.migration) {
    throw new Error("promoted source-consistency migration differs from the provider-proven draft");
  }
  return candidate;
}

function main() {
  const candidate = buildCheckoutStockReservationSourceConsistencyCandidate();
  if (process.argv.includes("--print-migration")) {
    process.stdout.write(candidate.migration);
    return;
  }
  if (process.argv.includes("--promote")) {
    const migrationDirectory = path.join(
      process.cwd(),
      "prisma/migrations",
      candidate.migrationName,
    );
    const migrationPath = path.join(migrationDirectory, "migration.sql");
    if (fs.existsSync(migrationDirectory)) {
      throw new Error("refusing to overwrite an existing promoted migration");
    }
    fs.mkdirSync(migrationDirectory);
    fs.writeFileSync(migrationPath, candidate.migration, { encoding: "utf8", flag: "wx" });
  }
  process.stdout.write(`${JSON.stringify({
    draftSha256: candidate.draftSha256,
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`CheckoutStockReservation source-consistency staging failed closed: ${
      error instanceof Error ? error.message : "unknown error"
    }\n`);
    process.exitCode = 1;
  }
}
