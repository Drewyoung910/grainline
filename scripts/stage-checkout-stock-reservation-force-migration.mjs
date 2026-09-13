#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildCheckoutStockReservationForceCandidate,
} from "./build-checkout-stock-reservation-force-candidate.mjs";

export function verifyPromotedCheckoutStockReservationForce(
  rootDirectory = process.cwd(),
) {
  const candidate = buildCheckoutStockReservationForceCandidate(rootDirectory);
  const migrationPath = path.join(
    rootDirectory,
    "prisma/migrations",
    candidate.migrationName,
    "migration.sql",
  );
  if (!fs.existsSync(migrationPath)) {
    throw new Error("promoted CheckoutStockReservation FORCE migration is missing");
  }
  if (fs.readFileSync(migrationPath, "utf8") !== candidate.migration) {
    throw new Error(
      "promoted CheckoutStockReservation FORCE differs from the byte-pinned candidate",
    );
  }
  return candidate;
}

function promoteCheckoutStockReservationForce(rootDirectory = process.cwd()) {
  const candidate = buildCheckoutStockReservationForceCandidate(rootDirectory);
  const migrationDirectory = path.join(
    rootDirectory,
    "prisma/migrations",
    candidate.migrationName,
  );
  const migrationPath = path.join(migrationDirectory, "migration.sql");
  if (fs.existsSync(migrationDirectory)) {
    throw new Error(
      "refusing to overwrite an existing CheckoutStockReservation FORCE migration",
    );
  }
  fs.mkdirSync(migrationDirectory, { mode: 0o700 });
  fs.writeFileSync(migrationPath, candidate.migration, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  return candidate;
}

function main() {
  const mode = process.argv[2] ?? "--verify";
  if (!new Set(["--verify", "--promote"]).has(mode)) {
    throw new Error(
      "usage: stage-checkout-stock-reservation-force-migration.mjs "
      + "[--verify|--promote]",
    );
  }
  const candidate = mode === "--promote"
    ? promoteCheckoutStockReservationForce()
    : verifyPromotedCheckoutStockReservationForce();
  process.stdout.write(`${JSON.stringify({
    mode,
    migrationName: candidate.migrationName,
    migrationSha256: candidate.migrationSha256,
    protectedTables: 1,
    rlsEnabled: true,
    rlsForced: true,
    policyCount: 0,
    runtimeTablePrivileges: 0,
    rowDataChanged: false,
    productionChanged: false,
  }, null, 2)}\n`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(
      `CheckoutStockReservation FORCE staging failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
