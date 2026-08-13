import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS,
} from "./checkout-stock-reservation-authority-catalog.mjs";

const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const AUTHORITY_MIGRATION = path.join(
  "prisma",
  "migrations",
  "20260810190000_prepare_checkout_stock_reservation_authority",
  "migration.sql",
);

function normalizeIdentityArguments(declarations) {
  const trimmed = declarations.trim();
  if (trimmed.length === 0) return "";
  return trimmed.split(",").map((declaration) => {
    const tokens = declaration.trim()
      .replace(/\s+DEFAULT\s+[\s\S]*$/i, "")
      .replace(/^IN\s+/i, "")
      .split(/\s+/);
    if (tokens.length < 2) {
      throw new Error(`reservation function argument is not named: ${declaration.trim()}`);
    }
    return tokens.slice(1).join(" ").toLowerCase();
  }).join(", ");
}

export function checkoutStockReservationFunctionSources(rootDir = ROOT_DIR) {
  const migration = readFileSync(path.join(rootDir, AUTHORITY_MIGRATION), "utf8");
  const expected = new Set(
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_FUNCTIONS.map(
      (entry) => `${entry.name}(${entry.argumentTypes})`,
    ),
  );
  const sources = new Map();
  const pattern = /\bCREATE\s+FUNCTION\s+public\.(grainline_(?:checkout_reservation_[A-Za-z0-9_]+|stripe_webhook_(?:begin|bind_source)))\s*\(([\s\S]*?)\)\s*RETURNS[\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\3;/g;
  for (const match of migration.matchAll(pattern)) {
    const signature = `${match[1]}(${normalizeIdentityArguments(match[2])})`;
    if (expected.has(signature)) sources.set(signature, match[4]);
  }
  const missing = [...expected].filter((signature) => !sources.has(signature));
  if (missing.length > 0 || sources.size !== expected.size) {
    throw new Error(`reservation function source catalog drifted: ${missing.join(",")}`);
  }
  return Object.freeze(Object.fromEntries([...sources].sort()));
}

export function checkoutStockReservationFunctionSourceSha256(rootDir = ROOT_DIR) {
  return Object.freeze(Object.fromEntries(
    Object.entries(checkoutStockReservationFunctionSources(rootDir)).map(
      ([signature, source]) => [
        signature,
        createHash("sha256").update(source, "utf8").digest("hex"),
      ],
    ),
  ));
}
