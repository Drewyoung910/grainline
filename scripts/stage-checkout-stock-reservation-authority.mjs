#!/usr/bin/env node

import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION =
  "20260810190000_prepare_checkout_stock_reservation_authority";
export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_DRAFT =
  "docs/rls-drafts/checkout-stock-reservation-authority.sql";
export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_DRAFT_SHA256 =
  "66a3d711de1cab2eccb4407a3cdd0925f3ce13bdb6ce4a4fd647e74ab3bfa2ec";

function sha256(source) {
  return createHash("sha256").update(source).digest("hex");
}

function readPinnedDraft(rootDirectory) {
  const draftPath = path.join(
    rootDirectory,
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_DRAFT,
  );
  const source = fs.readFileSync(draftPath, "utf8");
  if (sha256(source) !== CHECKOUT_STOCK_RESERVATION_AUTHORITY_DRAFT_SHA256) {
    throw new Error("CheckoutStockReservation authority draft bytes drifted");
  }
  const normalizedBoundary = source.replace(/^--\s?/gm, "").replace(/\s+/g, " ");
  if (!source.includes("DRAFT ONLY") || !normalizedBoundary.includes("not a production migration")) {
    throw new Error("CheckoutStockReservation authority draft lost its draft-only boundary");
  }

  const beginMarker = "\nBEGIN;\n";
  const beginIndex = source.indexOf(beginMarker);
  if (beginIndex < 0 || !source.endsWith("\nCOMMIT;\n")) {
    throw new Error("CheckoutStockReservation authority draft is not one exact transaction");
  }
  const body = source.slice(
    beginIndex + beginMarker.length,
    -"\nCOMMIT;\n".length,
  );
  if (/^\s*(?:BEGIN|COMMIT);/m.test(body)) {
    throw new Error("CheckoutStockReservation authority draft contains nested transaction boundaries");
  }
  return body;
}

export function buildCheckoutStockReservationAuthorityCandidate(
  rootDirectory = process.cwd(),
) {
  const body = readPinnedDraft(rootDirectory);
  const migration = `-- Coexistence-safe CheckoutStockReservation authority preparation.
--
-- This migration adds source-bound Stripe webhook leases and fixed reservation
-- lifecycle operations while preserving predecessor table grants and RLS
-- posture. It is additive compatibility work, not an RLS activation.

BEGIN;

${body}

COMMIT;
`;

  if (/ALTER TABLE public\."CheckoutStockReservation"\s+(?:ENABLE|FORCE) ROW LEVEL SECURITY/i.test(migration)) {
    throw new Error("CheckoutStockReservation authority candidate must not activate RLS");
  }
  if (/(?:GRANT|REVOKE)[\s\S]{0,120}ON TABLE public\."CheckoutStockReservation"/i.test(migration)) {
    throw new Error("CheckoutStockReservation authority candidate must preserve predecessor table grants");
  }
  if (!migration.includes("grainline_stripe_webhook_begin(text, text, text)")) {
    throw new Error("CheckoutStockReservation authority candidate lost atomic Stripe source binding");
  }

  return Object.freeze({
    migration,
    migrationName: CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
    migrationSha256: sha256(migration),
    draftSha256: CHECKOUT_STOCK_RESERVATION_AUTHORITY_DRAFT_SHA256,
  });
}

export function verifyPromotedCheckoutStockReservationAuthority(
  rootDirectory = process.cwd(),
) {
  const candidate = buildCheckoutStockReservationAuthorityCandidate(rootDirectory);
  const migrationPath = path.join(
    rootDirectory,
    "prisma",
    "migrations",
    candidate.migrationName,
    "migration.sql",
  );
  if (!fs.existsSync(migrationPath)) {
    throw new Error("promoted CheckoutStockReservation authority migration is missing");
  }
  if (fs.readFileSync(migrationPath, "utf8") !== candidate.migration) {
    throw new Error("promoted CheckoutStockReservation authority migration differs from reviewed draft");
  }
  return candidate;
}

function main() {
  const candidate = buildCheckoutStockReservationAuthorityCandidate();
  if (process.argv.includes("--print-migration")) {
    process.stdout.write(candidate.migration);
    return;
  }
  if (process.argv.includes("--promote")) {
    const migrationDirectory = path.join(
      process.cwd(),
      "prisma",
      "migrations",
      candidate.migrationName,
    );
    const migrationPath = path.join(migrationDirectory, "migration.sql");
    if (fs.existsSync(migrationDirectory)) {
      throw new Error("refusing to overwrite an existing promoted migration");
    }
    fs.mkdirSync(migrationDirectory);
    fs.writeFileSync(migrationPath, candidate.migration, {
      encoding: "utf8",
      flag: "wx",
    });
  }
  if (process.argv.includes("--refresh-promoted")) {
    const migrationPath = path.join(
      process.cwd(),
      "prisma",
      "migrations",
      candidate.migrationName,
      "migration.sql",
    );
    if (!fs.existsSync(migrationPath)) {
      throw new Error("cannot refresh a missing promoted migration");
    }
    fs.writeFileSync(migrationPath, candidate.migration, "utf8");
  }
  process.stdout.write(`${JSON.stringify({
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    draftSha256: candidate.draftSha256,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `CheckoutStockReservation authority staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
