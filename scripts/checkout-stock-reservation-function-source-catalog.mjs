import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const AUTHORITY_MIGRATION = path.join(
  "prisma",
  "migrations",
  "20260810190000_prepare_checkout_stock_reservation_authority",
  "migration.sql",
);

function digest(algorithm, value) {
  return createHash(algorithm).update(value, "utf8").digest("hex");
}

function normalizeIdentityArguments(declarations) {
  const trimmed = declarations.trim();
  if (trimmed.length === 0) return "";
  return trimmed
    .split(",")
    .map((declaration) => {
      const withoutDefault = declaration
        .trim()
        .replace(/\s+DEFAULT\s+[\s\S]*$/i, "")
        .replace(/^IN\s+/i, "");
      const tokens = withoutDefault.split(/\s+/);
      if (tokens.length < 2) {
        throw new Error(
          `CheckoutStockReservation function argument declaration is not named: ${declaration.trim()}`,
        );
      }
      return tokens.slice(1).join(" ").toLowerCase();
    })
    .join(", ");
}

export function checkoutStockReservationFunctionSources(rootDir = ROOT_DIR) {
  const migration = readFileSync(path.join(rootDir, AUTHORITY_MIGRATION), "utf8");
  const expected = new Map(
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.map((entry) => [
      `${entry.name}(${entry.argumentTypes})`,
      entry,
    ]),
  );
  const sources = new Map();
  const pattern = /\bCREATE\s+FUNCTION\s+public\.(grainline_(?:checkout_reservation_[A-Za-z0-9_]+|stripe_webhook_(?:begin|bind_source)))\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\3;/g;
  for (const match of migration.matchAll(pattern)) {
    const identityArguments = normalizeIdentityArguments(match[2]);
    const signature = `${match[1]}(${identityArguments})`;
    if (expected.has(signature)) sources.set(signature, match[4]);
  }

  const missing = [...expected.keys()]
    .filter((signature) => !sources.has(signature))
    .sort((left, right) => left.localeCompare(right));
  if (missing.length > 0 || sources.size !== expected.size) {
    throw new Error(
      `CheckoutStockReservation function-source catalog drifted: missing=${missing.join(",") || "none"}`,
    );
  }
  return Object.freeze(Object.fromEntries(
    [...sources].sort(([left], [right]) => left.localeCompare(right)),
  ));
}

export function checkoutStockReservationFunctionSourceMd5(rootDir = ROOT_DIR) {
  return Object.freeze(Object.fromEntries(
    Object.entries(checkoutStockReservationFunctionSources(rootDir))
      .map(([signature, source]) => [signature, digest("md5", source)]),
  ));
}

export function checkoutStockReservationFunctionSourceSha256(rootDir = ROOT_DIR) {
  return Object.freeze(Object.fromEntries(
    Object.entries(checkoutStockReservationFunctionSources(rootDir))
      .map(([signature, source]) => [signature, digest("sha256", source)]),
  ));
}
