#!/usr/bin/env node

import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
  ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256,
} from "./stage-order-payment-event-force-migration.mjs";
import {
  parseOrderPaymentEventActivationScopeEnvironment,
  assertOrderPaymentEventActivationProductionScope,
  readOrderPaymentEventActivationProductionSnapshotFromClient,
} from "./verify-order-payment-event-activation-production-scope.mjs";
import {
  SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS,
  assertSellerPayoutEventForceReviewedSuccessorScope,
  readSellerPayoutEventForceSealedPrefixCatalog,
} from "./verify-seller-payout-event-force-production-scope.mjs";
import {
  verifyOrderPaymentEventForceRelease,
} from "./verify-order-payment-event-force-release.mjs";
import {
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;
export const ORDER_PAYMENT_EVENT_FORCE_LEDGER_QUERY = `
  SELECT migration_name, checksum, finished_at, rolled_back_at,
         applied_steps_count
    FROM public._prisma_migrations
   ORDER BY migration_name, started_at, id
`;
export const ORDER_PAYMENT_EVENT_FORCE_SCOPE_STAGES = Object.freeze([
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

export function parseOrderPaymentEventForceScopeEnvironment(
  env = process.env,
) {
  const stage = required(env, "ORDER_PAYMENT_EVENT_FORCE_SCOPE_STAGE");
  if (!ORDER_PAYMENT_EVENT_FORCE_SCOPE_STAGES.includes(stage)) {
    throw new Error("OrderPaymentEvent FORCE scope stage is invalid");
  }
  const activation = parseOrderPaymentEventActivationScopeEnvironment({
    ...env,
    ORDER_PAYMENT_EVENT_ACTIVATION_SCOPE_STAGE: "after",
  });
  return Object.freeze({
    directUrl: activation.directUrl,
    identity: activation.identity,
    stage,
  });
}

export function readOrderPaymentEventForceMigrationCatalog(
  root = process.cwd(),
) {
  const release = verifyOrderPaymentEventForceRelease(root);
  const forcePrefix = readSellerPayoutEventForceSealedPrefixCatalog(root);
  const catalog = [
    ...forcePrefix,
    ...SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS,
  ];
  if (
    catalog.at(-1)?.migration_name
      !== release.activationMigration
    || catalog.at(-1)?.checksum
      !== release.activationMigrationSha256
    || new Set(catalog.map((entry) => entry.migration_name)).size
      !== catalog.length
    || forcePrefix.at(-1)?.migration_name
      >= SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS[0]?.migration_name
    || SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.some(
      (entry, index, entries) => index > 0
        && entries[index - 1].migration_name >= entry.migration_name,
    )
  ) {
    throw new Error("OrderPaymentEvent FORCE predecessor catalog drifted");
  }
  return Object.freeze([
    ...catalog,
    Object.freeze({
      migration_name: ORDER_PAYMENT_EVENT_FORCE_MIGRATION,
      checksum: ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256,
    }),
  ]);
}

function isAppliedRow(row, checksum) {
  return row?.checksum === checksum
    && row.finished_at != null
    && row.rolled_back_at == null
    && Number(row.applied_steps_count) === 1;
}

export function assertOrderPaymentEventForceProductionScope(
  snapshot,
  stage,
  {
    catalog = readOrderPaymentEventForceMigrationCatalog(),
    root = process.cwd(),
    migrationRole = "neondb_owner",
    runtimeRole = "grainline_app_runtime",
  } = {},
) {
  if (!ORDER_PAYMENT_EVENT_FORCE_SCOPE_STAGES.includes(stage)) {
    throw new Error("OrderPaymentEvent FORCE scope stage is invalid");
  }
  const force = catalog.at(-1);
  if (
    !Array.isArray(snapshot?.ledgerRows)
    || !Array.isArray(catalog)
    || force?.migration_name !== ORDER_PAYMENT_EVENT_FORCE_MIGRATION
    || force?.checksum !== ORDER_PAYMENT_EVENT_FORCE_MIGRATION_SHA256
  ) {
    throw new Error("OrderPaymentEvent FORCE scope catalog is invalid");
  }
  const forceRows = snapshot.ledgerRows.filter(
    (row) => row?.migration_name === force.migration_name,
  );
  const predecessorRows = snapshot.ledgerRows.filter(
    (row) => row?.migration_name !== force.migration_name,
  );
  const predecessor = assertSellerPayoutEventForceReviewedSuccessorScope(
    predecessorRows,
    "after-order-payment-event-activation",
    {
      forceCatalog: catalog.slice(
        0,
        catalog.length
          - SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.length
          - 1,
      ),
      successors: catalog.slice(
        catalog.length
          - SELLER_PAYOUT_EVENT_FORCE_REVIEWED_SUCCESSORS.length
          - 1,
        -1,
      ),
    },
  );
  const forceApplied = forceRows.length === 1
    && isAppliedRow(forceRows[0], force.checksum);
  if (
    (stage === "before" && forceRows.length !== 0)
    || (stage === "after" && !forceApplied)
    || (stage === "restart" && forceRows.length !== 0 && !forceApplied)
  ) {
    throw new Error("OrderPaymentEvent FORCE ledger is at the wrong stage");
  }

  const table = assertOrderPaymentEventActivationProductionScope(
    snapshot.orderPaymentEvent,
    "after",
    { root, migrationRole, runtimeRole, expectedForce: forceApplied },
  );
  return Object.freeze({
    ...predecessor,
    orderPaymentEventForceApplied: forceApplied,
    orderPaymentEventRlsEnabled: table.orderPaymentEventRlsEnabled,
    orderPaymentEventRlsForced: table.orderPaymentEventRlsForced,
    runtimeFunctionCount: table.runtimeFunctionCount,
    privateFunctionCount: table.privateFunctionCount,
    policyCount: 0,
    state: forceApplied ? "force-hardened" : "phase-a-accepted",
    productionChangedByProof: false,
  });
}

export async function readOrderPaymentEventForceProductionSnapshot(
  connectionString,
  { root = process.cwd() } = {},
) {
  const client = new Client({
    connectionString,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 30_000,
    query_timeout: 35_000,
    application_name: "grainline-order-payment-force-scope-proof",
    ...postgresChannelBindingClientOptions(new URL(connectionString)),
  });
  await client.connect();
  let open = false;
  try {
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    open = true;
    const transaction = (await client.query(`
      SELECT pg_catalog.current_setting('transaction_isolation') AS isolation,
             pg_catalog.current_setting('transaction_read_only') AS read_only
    `)).rows[0];
    if (
      transaction?.isolation !== "repeatable read"
      || transaction?.read_only !== "on"
    ) {
      throw new Error("OrderPaymentEvent FORCE scope is not engine-read-only");
    }
    // Read the complete ledger. The exact-scope assertion rejects every
    // unreviewed predecessor or successor row; bounding this query at the
    // FORCE migration would make a later out-of-band row invisible.
    const ledgerRows = (await client.query(
      ORDER_PAYMENT_EVENT_FORCE_LEDGER_QUERY,
    )).rows;
    const orderPaymentEvent =
      await readOrderPaymentEventActivationProductionSnapshotFromClient(
        client,
        { root },
      );
    await client.query("ROLLBACK");
    open = false;
    return Object.freeze({ ledgerRows, orderPaymentEvent });
  } finally {
    if (open) await client.query("ROLLBACK").catch(() => {});
    await client.end();
  }
}

async function main() {
  try {
    const config = parseOrderPaymentEventForceScopeEnvironment();
    const snapshot = await readOrderPaymentEventForceProductionSnapshot(
      config.directUrl,
    );
    process.stdout.write(`${JSON.stringify(
      assertOrderPaymentEventForceProductionScope(snapshot, config.stage),
    )}\n`);
  } catch {
    process.stderr.write(
      "OrderPaymentEvent FORCE production scope proof failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
