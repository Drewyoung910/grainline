#!/usr/bin/env node

import { pathToFileURL } from "node:url";

import {
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
  ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256,
} from "./order-payment-event-activation-identity.mjs";
import {
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256,
} from "./order-payment-event-aggregate-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
  ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_SHA256,
} from "./order-payment-event-invariants-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256,
} from "./order-payment-event-read-authority-catalog.mjs";
import {
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION_SHA256,
} from "./order-payment-event-transition-authority-catalog.mjs";
import {
  ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION_SHA256,
} from "./order-payment-signed-authority-catalog.mjs";
import {
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256,
} from "./build-order-payment-signed-dispute-identity-migration.mjs";
import {
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
  ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256,
} from "./build-order-payment-signed-refund-identity-migration.mjs";
import {
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
  BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256,
} from "./build-blocked-checkout-refund-delivery-migration.mjs";
import {
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
  BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256,
} from "./build-blocked-checkout-transfer-binding-migration.mjs";
import {
  ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
  ORDER_REFUND_CLAIM_GENERATION_MIGRATION_SHA256,
} from "./order-refund-claim-generation-catalog.mjs";
import {
  ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
  ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION_SHA256,
} from "./order-refund-inactive-seller-recovery-catalog.mjs";
import {
  ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
  ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256,
} from "./order-refund-reconciliation-authority-catalog.mjs";
import {
  ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
  ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256,
} from "./order-refund-record-authority-catalog.mjs";
import {
  SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
  buildSellerPayoutEventActivationCandidate,
} from "./stage-seller-payout-event-activation-migration.mjs";
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
  readSellerPayoutEventAuthorityMigrationCatalog,
  readSellerPayoutEventProductionSnapshot,
} from "./verify-seller-payout-event-authority-production-scope.mjs";
import {
  verifySellerPayoutEventForceRelease,
} from "./verify-seller-payout-event-force-release.mjs";
import {
  verifyOrderPaymentEventActivationRelease,
} from "./verify-order-payment-event-activation-release.mjs";

export const SELLER_PAYOUT_EVENT_FORCE_SCOPE_STAGES = Object.freeze([
  "before",
  "after",
  "restart",
]);
export const SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSOR_STAGES =
  Object.freeze([
    "before-order-payment-event-activation",
    "after-order-payment-event-activation",
  ]);
export const SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS = Object.freeze([
  Object.freeze({
    migration_name: ORDER_REFUND_CLAIM_GENERATION_MIGRATION,
    checksum: ORDER_REFUND_CLAIM_GENERATION_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_REFUND_RECORD_AUTHORITY_MIGRATION,
    checksum: ORDER_REFUND_RECORD_AUTHORITY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION,
    checksum: ORDER_PAYMENT_SIGNED_AUTHORITY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION,
    checksum: ORDER_REFUND_RECONCILIATION_AUTHORITY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION,
    checksum: ORDER_REFUND_INACTIVE_SELLER_RECOVERY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION,
    checksum: BLOCKED_CHECKOUT_REFUND_DELIVERY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION,
    checksum: BLOCKED_CHECKOUT_TRANSFER_BINDING_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION,
    checksum: ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION,
    checksum: ORDER_PAYMENT_SIGNED_DISPUTE_IDENTITY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION,
    checksum: ORDER_PAYMENT_EVENT_INVARIANTS_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION,
    checksum: ORDER_PAYMENT_EVENT_READ_AUTHORITY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION,
    checksum: ORDER_PAYMENT_EVENT_AGGREGATE_AUTHORITY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION,
    checksum: ORDER_PAYMENT_EVENT_TRANSITION_AUTHORITY_MIGRATION_SHA256,
  }),
  Object.freeze({
    migration_name: ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION,
    checksum: ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256,
  }),
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
  const reviewedSuccessorStage =
    env.SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSOR_STAGE ?? "";
  if (
    reviewedSuccessorStage !== ""
    && !SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSOR_STAGES.includes(
      reviewedSuccessorStage,
    )
  ) {
    throw new Error("payout FORCE reviewed successor stage is invalid");
  }
  const activation = parseSellerPayoutEventActivationScopeEnvironment({
    ...env,
    SELLER_PAYOUT_EVENT_ACTIVATION_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: activation.directUrl,
    identity: activation.identity,
    stage,
    reviewedSuccessorStage,
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
      allowReviewedRefundRecordSuccessor: true,
      allowReviewedSignedAuthoritySuccessor: true,
    },
  );
  const release = verifySellerPayoutEventForceRelease(root, {
    allowReviewedRefundClaimSuccessor: true,
    allowReviewedRefundRecordSuccessor: true,
    allowReviewedSignedAuthoritySuccessor: true,
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

export function readSellerPayoutEventForceSealedPrefixCatalog(
  root = process.cwd(),
) {
  verifyOrderPaymentEventActivationRelease(root, {
    allowReviewedForceSuccessor: true,
  });
  const authorityCatalog = readSellerPayoutEventAuthorityMigrationCatalog(root);
  const activation = buildSellerPayoutEventActivationCandidate(root);
  if (
    authorityCatalog.some(
      (entry) => entry.migration_name === SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
    )
    || authorityCatalog.at(-1)?.migration_name
      >= SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION
  ) {
    throw new Error("reviewed payout FORCE sealed prefix is not exact");
  }
  return Object.freeze([
    ...authorityCatalog,
    Object.freeze({
      migration_name: SELLER_PAYOUT_EVENT_ACTIVATION_MIGRATION,
      checksum: activation.migrationSha256,
    }),
    Object.freeze({
      migration_name: SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
      checksum: SELLER_PAYOUT_EVENT_FORCE_MIGRATION_SHA256,
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

export function assertSellerPayoutEventForceReviewedSuccessorScope(
  rows,
  reviewedSuccessorStage,
  {
    forceCatalog = readSellerPayoutEventForceSealedPrefixCatalog(),
    successors = SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS,
  } = {},
) {
  if (
    !Array.isArray(rows)
    || !SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSOR_STAGES.includes(
      reviewedSuccessorStage,
    )
    || !Array.isArray(forceCatalog)
    || !Array.isArray(successors)
    || successors.length !== 14
    || successors.at(-1)?.migration_name
      !== ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION
    || successors.at(-1)?.checksum
      !== ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION_SHA256
  ) {
    throw new Error("production ledger is not the exact reviewed successor scope");
  }
  if (
    rows.some((row) => typeof row?.migration_name !== "string")
    || new Set(successors.map((entry) => entry.migration_name)).size
      !== successors.length
    || successors.some((entry, index) =>
      typeof entry?.migration_name !== "string"
      || !/^[0-9]{8,14}_[a-z0-9_]+$/u.test(entry.migration_name)
      || typeof entry?.checksum !== "string"
      || !/^[0-9a-f]{64}$/u.test(entry.checksum)
      || entry.migration_name <= SELLER_PAYOUT_EVENT_FORCE_MIGRATION
      || (
        index > 0
        && successors[index - 1].migration_name >= entry.migration_name
      )
    )
  ) {
    throw new Error("production ledger has malformed reviewed successors");
  }

  const forceRows = rows.filter(
    (row) => row.migration_name <= SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  );
  const successorRows = rows.filter(
    (row) => row.migration_name > SELLER_PAYOUT_EVENT_FORCE_MIGRATION,
  );
  const force = assertSellerPayoutEventForceProductionScope(
    forceRows,
    "after",
    forceCatalog,
  );
  const expectedSuccessors = new Map(
    successors.map((entry) => [entry.migration_name, entry.checksum]),
  );
  if (
    successorRows.some(
      (row) => !expectedSuccessors.has(row.migration_name),
    )
  ) {
    throw new Error("production ledger has an unreviewed successor row");
  }

  for (const [migrationName, checksum] of expectedSuccessors) {
    const matches = successorRows.filter(
      (row) => row.migration_name === migrationName,
    );
    const targetMustBeAbsent =
      migrationName === ORDER_PAYMENT_EVENT_ACTIVATION_MIGRATION
      && reviewedSuccessorStage === "before-order-payment-event-activation";
    if (
      (targetMustBeAbsent && matches.length !== 0)
      || (!targetMustBeAbsent
        && (matches.length !== 1
          || !isAppliedRow(matches[0], checksum)))
    ) {
      throw new Error(`production ledger successor drifted: ${migrationName}`);
    }
  }

  return Object.freeze({
    ...force,
    reviewedSuccessorMigrationCount: successors.length,
    orderPaymentEventActivationApplied:
      reviewedSuccessorStage === "after-order-payment-event-activation",
    state: reviewedSuccessorStage,
  });
}

export async function verifySellerPayoutEventForceProductionScope(
  config,
  {
    readSnapshot = readSellerPayoutEventProductionSnapshot,
    readCatalog = readSellerPayoutEventForceMigrationCatalog,
    readSealedPrefixCatalog = readSellerPayoutEventForceSealedPrefixCatalog,
  } = {},
) {
  const snapshot = await readSnapshot(config.directUrl);
  if (config.reviewedSuccessorStage !== "") {
    return assertSellerPayoutEventForceReviewedSuccessorScope(
      snapshot.ledgerRows,
      config.reviewedSuccessorStage,
      { forceCatalog: readSealedPrefixCatalog() },
    );
  }
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
