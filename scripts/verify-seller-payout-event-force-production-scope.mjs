#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
} from "./stage-seller-payout-event-force-migration.mjs";
import {
  assertSellerPayoutEventActivationProductionScope,
  parseSellerPayoutEventActivationScopeEnvironment,
  readSellerPayoutEventActivationMigrationCatalog,
} from "./verify-seller-payout-event-activation-production-scope.mjs";
import {
  readSellerPayoutEventProductionSnapshot,
} from "./verify-seller-payout-event-authority-production-scope.mjs";
import {
  verifySellerPayoutEventForceRelease,
} from "./verify-seller-payout-event-force-release.mjs";

export const SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGES = Object.freeze([
  "before",
  "after",
  "restart",
]);

function required(env, key) {
  const value = env?.[key];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${key} is required without surrounding whitespace`);
  }
  return value;
}

export function parseSellerPayoutEventForceScopeEnvironment(
  env = process.env,
) {
  const stage = required(env, "SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGE");
  if (!SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGES.includes(stage)) {
    throw new Error("payout FORCE scope stage must be before, after, or restart");
  }
  const activation = parseSellerPayoutEventActivationScopeEnvironment({
    ...env,
    SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: activation.directUrl,
    identity: activation.identity,
    stage,
  });
}

export function readSellerPayoutEventForceMigrationCatalog(
  root = process.cwd(),
) {
  const activationCatalog = readSellerPayoutEventActivationMigrationCatalog(
    root,
    {
      allowReviewedForceSuccessor: true,
      allowReviewedRefundClaimSuccessor: true,
    },
  );
  const release = verifySellerPayoutEventForceRelease(root, {
    allowReviewedRefundClaimSuccessor: true,
  });
  if (
    release.migration !== SELLER_PAYOUT_EVENT_FORCE_MIGRATION
    || release.migrationSha256 !== SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256
    || activationCatalog.some(
      (entry) => entry.migration_name === release.migration,
    )
    || activationCatalog.at(-1)?.migration_name >= release.migration
  ) {
    throw new Error("reviewed payout FORCE does not follow activation prefix");
  }
  return Object.freeze([
    ...activationCatalog,
    Object.freeze({
      migration_name: release.migration,
      checksum: release.migrationSha256,
    }),
  ]);
}

function isAppliedRow(row, checksum) {
  return row?.checksum === checksum
    && row.finished_at !== null
    && row.finished_at !== undefined
    && row.rolled_back_at === null
    && Number(row.applied_steps_count) === 1;
}

export function assertSellerPayoutEventForceProductionScope(
  rows,
  stage,
  catalog = readSellerPayoutEventForceMigrationCatalog(),
) {
  if (!SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGES.includes(stage)) {
    throw new Error("payout FORCE scope stage must be before, after, or restart");
  }
  const force = catalog.at(-1);
  const activationCatalog = catalog.slice(0, -1);
  if (
    !Array.isArray(rows)
    || catalog.length < 2
    || force?.migration_name !== SELLER_PAYOUT_EVENT_FORCE_MIGRATION
    || force.checksum !== SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256
  ) {
    throw new Error("production ledger is not the exact payout FORCE scope");
  }

  const forceRows = rows.filter(
    (row) => row?.migration_name === force.migration_name,
  );
  const predecessorRows = rows.filter(
    (row) => row?.migration_name !== force.migration_name,
  );
  const predecessor = assertSellerPayoutEventActivationProductionScope(
    predecessorRows,
    "after",
    activationCatalog,
  );
  const forceApplied = forceRows.length === 1
    && isAppliedRow(forceRows[0], force.checksum);
  if (
    (stage === "before" && forceRows.length !== 0)
    || (stage === "after" && !forceApplied)
    || (stage === "restart" && forceRows.length !== 0 && !forceApplied)
  ) {
    throw new Error("production ledger is not the exact payout FORCE scope");
  }

  return Object.freeze({
    payoutAuthorityApplied: predecessor.payoutAuthorityApplied,
    payoutActivationApplied: predecessor.payoutActivationApplied,
    payoutForceApplied: forceApplied,
    payoutRlsEnabled: true,
    payoutRlsForced: forceApplied,
    policyCount: 0,
    reviewedMigrationCount: catalog.length,
    historicalLedgerExceptionCount:
      predecessor.historicalLedgerExceptionCount,
    state: forceApplied ? "force-hardened" : "activated",
    productionChangedByProof: false,
  });
}

export async function verifySellerPayoutEventForceProductionScope(
  config,
  {
    readSnapshot = readSellerPayoutEventProductionSnapshot,
    readCatalog = readSellerPayoutEventForceMigrationCatalog,
  } = {},
) {
  const snapshot = await readSnapshot(config.directUrl);
  return assertSellerPayoutEventForceProductionScope(
    snapshot.ledgerRows,
    config.stage,
    readCatalog(),
  );
}

async function main() {
  try {
    const config = parseSellerPayoutEventForceScopeEnvironment();
    const result = await verifySellerPayoutEventForceProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "SellerPayoutEvent FORCE production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
