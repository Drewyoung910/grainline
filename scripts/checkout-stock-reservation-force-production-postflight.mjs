#!/usr/bin/env node

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  REVIEWED_PRODUCTION_RUNTIME_IDENTITY,
  assertVercelRuntimeDatabaseIsolation,
  privilegedDatabaseEnvironmentKeys,
  unreviewedPostgresUrlEnvironmentKeys,
} from "./guard-runtime-db-env.mjs";
import {
  assertDeterministicPostgresEnvironment,
} from "./postgres-url-safety.mjs";
import {
  runCheckoutStockReservationActivationPostflight,
} from "./checkout-stock-reservation-activation-production-postflight.mjs";

export const CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRMATION =
  "verify-production-checkout-stock-reservation-force-runtime-read-only";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SAFE_POSITIVE_INTEGER = /^[1-9][0-9]{0,19}$/;
const EVIDENCE_PREFIX = "checkout-stock-reservation-force-production-postflight-";

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

function positiveInteger(env, key) {
  const raw = required(env, key);
  if (!SAFE_POSITIVE_INTEGER.test(raw)) {
    throw new Error(`${key} must be a positive integer`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${key} must be a safe positive integer`);
  }
  return value;
}

function sha256(value) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function parseCheckoutStockReservationForcePostflightConfig(
  env = process.env,
) {
  assertDeterministicPostgresEnvironment(
    env,
    "CheckoutStockReservation FORCE production postflight",
  );
  if (
    env.CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRM
      !== CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_CONFIRMATION
  ) {
    throw new Error(
      "CheckoutStockReservation FORCE postflight confirmation is invalid",
    );
  }
  const privilegedKeys = privilegedDatabaseEnvironmentKeys(env);
  if (privilegedKeys.length > 0) {
    throw new Error(
      `CheckoutStockReservation FORCE postflight rejects privileged database keys: ${privilegedKeys.join(", ")}`,
    );
  }
  const unreviewedUrlKeys = unreviewedPostgresUrlEnvironmentKeys(env);
  if (unreviewedUrlKeys.length > 0) {
    throw new Error(
      `CheckoutStockReservation FORCE postflight rejects aliased PostgreSQL URLs: ${unreviewedUrlKeys.join(", ")}`,
    );
  }

  const releaseCommit = required(
    env,
    "CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_RELEASE_COMMIT",
  );
  if (!COMMIT_PATTERN.test(releaseCommit)) {
    throw new Error("CheckoutStockReservation FORCE release commit is invalid");
  }
  const databaseUrl = required(env, "DATABASE_URL");
  const runtimeIdentity = assertVercelRuntimeDatabaseIsolation({
    VERCEL: "1",
    VERCEL_ENV: "production",
    DATABASE_URL: databaseUrl,
    RUNTIME_DB_ROLE: REVIEWED_PRODUCTION_RUNTIME_IDENTITY.role,
    NODE_TLS_REJECT_UNAUTHORIZED: env.NODE_TLS_REJECT_UNAUTHORIZED,
    PGOPTIONS: env.PGOPTIONS,
  });
  const evidencePath = path.resolve(required(
    env,
    "CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_EVIDENCE_PATH",
  ));
  if (
    path.basename(evidencePath) !== `${EVIDENCE_PREFIX}${releaseCommit}.json`
    || existsSync(evidencePath)
  ) {
    throw new Error(
      "CheckoutStockReservation FORCE evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    databaseUrl,
    databaseUrlSha256: sha256(databaseUrl),
    evidencePath,
    mainCiRunId: positiveInteger(
      env,
      "CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MAIN_CI_RUN_ID",
    ),
    migrationRunId: positiveInteger(
      env,
      "CHECKOUT_STOCK_RESERVATION_FORCE_POSTFLIGHT_MIGRATION_RUN_ID",
    ),
    releaseCommit,
    runtimeIdentity,
  });
}

export async function runCheckoutStockReservationForcePostflight(config) {
  return runCheckoutStockReservationActivationPostflight(config, {
    evidenceOperation:
      "checkout-stock-reservation-force-production-postflight",
    expectedForced: true,
  });
}

async function main() {
  try {
    const config = parseCheckoutStockReservationForcePostflightConfig(
      process.env,
    );
    const evidence = await runCheckoutStockReservationForcePostflight(config);
    process.stdout.write(`${JSON.stringify({
      status: evidence.status,
      releaseCommit: evidence.source.commit,
      postflightReadOnly: evidence.proof.postflightReadOnly,
      rlsForced: evidence.proof.rlsForced,
      productionChangedByPostflight: evidence.productionChangedByPostflight,
    })}\n`);
  } catch (error) {
    process.stderr.write(
      `CheckoutStockReservation FORCE production postflight failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
