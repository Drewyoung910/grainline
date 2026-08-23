#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
  buildSellerPayoutEventActivationCandidate,
} from "./stage-seller-payout-event-activation-migration.mjs";
import {
  assertSellerPayoutEventAuthorityLedgerScope,
  parseSellerPayoutEventAuthorityScopeEnvironment,
  readSellerPayoutEventAuthorityMigrationCatalog,
  readSellerPayoutEventProductionSnapshot,
} from "./verify-seller-payout-event-authority-production-scope.mjs";
import {
  verifySellerPayoutEventActivationRelease,
} from "./verify-seller-payout-event-activation-release.mjs";

export const SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGES = Object.freeze([
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

export function parseSellerPayoutEventActivationScopeEnvironment(
  env = process.env,
) {
  const stage = required(
    env,
    "SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGE",
  );
  if (!SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGES.includes(stage)) {
    throw new Error("payout activation scope stage must be before, after, or restart");
  }
  const authority = parseSellerPayoutEventAuthorityScopeEnvironment({
    ...env,
    SELLER_PAYOUT_EVENT_AUTHORITY_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: authority.directUrl,
    identity: authority.identity,
    stage,
  });
}

export function readSellerPayoutEventActivationMigrationCatalog(
  root = process.cwd(),
) {
  const predecessor = readSellerPayoutEventAuthorityMigrationCatalog(root);
  const release = verifySellerPayoutEventActivationRelease(root);
  const candidate = buildSellerPayoutEventActivationCandidate(root);
  if (
    release.migration !== SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION
    || release.migrationSha256 !== candidate.migrationSha256
    || predecessor.some(
      (entry) => entry.migration_name === SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
    )
    || predecessor.at(-1)?.migration_name >= SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION
  ) {
    throw new Error(
      "reviewed payout activation does not exactly follow its authority predecessor",
    );
  }
  return Object.freeze([
    ...predecessor,
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

export function assertSellerPayoutEventActivationProductionScope(
  rows,
  stage,
  catalog = readSellerPayoutEventActivationMigrationCatalog(),
) {
  if (!SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGES.includes(stage)) {
    throw new Error("payout activation scope stage must be before, after, or restart");
  }
  const activation = catalog.at(-1);
  const predecessorCatalog = catalog.slice(0, -1);
  if (
    !Array.isArray(rows)
    || catalog.length < 2
    || activation?.migration_name !== SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION
    || typeof activation.checksum !== "string"
    || !/^[0-9a-f]{64}$/u.test(activation.checksum)
  ) {
    throw new Error("production ledger is not the exact payout activation scope");
  }

  const activationRows = rows.filter(
    (row) => row?.migration_name === activation.migration_name,
  );
  const predecessorRows = rows.filter(
    (row) => row?.migration_name !== activation.migration_name,
  );
  assertSellerPayoutEventAuthorityLedgerScope(
    predecessorRows,
    "after",
    predecessorCatalog,
  );
  const activationApplied = activationRows.length === 1
    && isAppliedRow(activationRows[0], activation.checksum);
  if (
    (stage === "before" && activationRows.length !== 0)
    || (stage === "after" && !activationApplied)
    || (stage === "restart"
      && activationRows.length !== 0
      && !activationApplied)
  ) {
    throw new Error("production ledger is not the exact payout activation scope");
  }

  return Object.freeze({
    payoutAuthorityApplied: true,
    payoutActivationApplied: activationApplied,
    payoutRlsEnabled: activationApplied,
    payoutRlsForced: false,
    policyCount: 0,
    reviewedMigrationCount: catalog.length,
    historicalLedgerExceptionCount: 3,
    state: activationApplied ? "activated" : "prepared",
    productionChangedByProof: false,
  });
}

export async function verifySellerPayoutEventActivationProductionScope(
  config,
  {
    readSnapshot = readSellerPayoutEventProductionSnapshot,
    readCatalog = readSellerPayoutEventActivationMigrationCatalog,
  } = {},
) {
  const snapshot = await readSnapshot(config.directUrl);
  return assertSellerPayoutEventActivationProductionScope(
    snapshot.ledgerRows,
    config.stage,
    readCatalog(),
  );
}

async function main() {
  try {
    const config = parseSellerPayoutEventActivationScopeEnvironment();
    const result = await verifySellerPayoutEventActivationProductionScope(config);
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch {
    process.stderr.write(
      "SellerPayoutEvent activation production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
