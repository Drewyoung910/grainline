import { createHash } from "node:crypto";
import {
  existsSync,
  readdirSync,
  readFileSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);

export const STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS = Object.freeze([
  Object.freeze({
    name: "grainline_stripe_webhook_begin",
    identityArguments: "text, text",
  }),
  Object.freeze({
    name: "grainline_stripe_webhook_complete",
    identityArguments: "text, bigint",
  }),
  Object.freeze({
    name: "grainline_stripe_webhook_fail",
    identityArguments: "text, bigint, text",
  }),
  Object.freeze({
    name: "grainline_stripe_webhook_prune_batch",
    identityArguments: "integer",
  }),
  Object.freeze({
    name: "grainline_stripe_webhook_health_summary",
    identityArguments: "",
  }),
  Object.freeze({
    name: "grainline_legacy_stock_restore_claim",
    identityArguments: "text",
  }),
]);

function digest(algorithm, value) {
  return createHash(algorithm).update(value, "utf8").digest("hex");
}

export function stripeWebhookEventFunctionSources(rootDir = ROOT_DIR) {
  const migrationsDir = path.join(rootDir, "prisma", "migrations");
  const expected = new Set(
    STRIPE_WEBHOOK_EVENT_RUNTIME_FUNCTIONS.map((entry) => entry.name),
  );
  const sources = new Map();
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })
    .filter((candidate) => candidate.isDirectory())
    .sort((left, right) => left.name.localeCompare(right.name))) {
    const migrationPath = path.join(migrationsDir, entry.name, "migration.sql");
    if (!existsSync(migrationPath)) continue;
    const sql = readFileSync(migrationPath, "utf8");
    const pattern = /\bCREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(grainline_(?:stripe_webhook_[A-Za-z0-9_]+|legacy_stock_restore_claim))\s*\([\s\S]*?\nAS\s+(\$[A-Za-z0-9_]*\$)([\s\S]*?)\2;/g;
    for (const match of sql.matchAll(pattern)) {
      if (expected.has(match[1])) sources.set(match[1], match[3]);
    }
  }

  const missing = [...expected]
    .filter((name) => !sources.has(name))
    .sort((left, right) => left.localeCompare(right));
  if (missing.length > 0 || sources.size !== expected.size) {
    throw new Error(
      `StripeWebhookEvent function-source catalog drifted: missing=${missing.join(",") || "none"}`,
    );
  }
  return Object.freeze(Object.fromEntries(
    [...sources].sort(([left], [right]) => left.localeCompare(right)),
  ));
}

export function stripeWebhookEventFunctionSourceMd5(rootDir = ROOT_DIR) {
  return Object.freeze(Object.fromEntries(
    Object.entries(stripeWebhookEventFunctionSources(rootDir))
      .map(([name, source]) => [name, digest("md5", source)]),
  ));
}

export function stripeWebhookEventFunctionSourceSha256(rootDir = ROOT_DIR) {
  return Object.freeze(Object.fromEntries(
    Object.entries(stripeWebhookEventFunctionSources(rootDir))
      .map(([name, source]) => [name, digest("sha256", source)]),
  ));
}
