#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  lstatSync,
  openSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import pg from "pg";
import { parseGuardedNeonDatabaseIdentity } from "./guard-saved-search-rls-deploy.mjs";
import {
  assertDeterministicPostgresEnvironment,
  postgresChannelBindingClientOptions,
} from "./postgres-url-safety.mjs";

const { Client } = pg;

export const ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_CONFIRMATION =
  "inspect-prelaunch-order-payment-shipping-legacy-state";
export const ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITE_CONFIRMATION =
  "case-force-and-runtime-separation-postflights-passed";

export const REVIEWED_ORDER_PAYMENT_SHIPPING_INSPECTION_TARGET = Object.freeze({
  databaseName: "neondb",
  endpointId: "ep-plain-river-aaqg8gj4",
  ownerRole: "neondb_owner",
  region: "westus3.azure",
  runtimeRole: "grainline_app_runtime",
});

export const ORDER_PAYMENT_SHIPPING_INSPECTION_TABLES = Object.freeze([
  "CheckoutStockReservation",
  "Order",
  "OrderItem",
  "OrderPaymentEvent",
  "OrderShippingRateQuote",
  "SellerPayoutEvent",
  "StripeWebhookEvent",
]);

export const ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS = Object.freeze([
  "order_count",
  "order_item_count",
  "shipping_quote_count",
  "payment_event_count",
  "payout_event_count",
  "reservation_count",
  "stripe_webhook_event_count",
  "order_without_item_count",
  "order_multi_seller_count",
  "order_buyer_is_seller_count",
  "item_invalid_quantity_count",
  "item_invalid_price_count",
  "order_invalid_currency_count",
  "payment_invalid_currency_count",
  "payout_invalid_currency_count",
  "item_missing_snapshot_count",
  "item_invalid_snapshot_shape_count",
  "item_invalid_variants_shape_count",
  "order_subtotal_mismatch_count",
  "purged_order_retains_pii_count",
  "pickup_state_invalid_count",
  "shipping_state_invalid_count",
  "fulfillment_timestamp_order_count",
  "quote_invalid_shape_count",
  "payment_negative_amount_count",
  "payment_unknown_type_count",
  "payment_mutated_count",
  "payout_negative_amount_count",
  "payout_source_missing_count",
  "reservation_invalid_payload_hash_count",
  "reservation_invalid_items_shape_count",
  "reservation_state_coherence_count",
  "stale_reservation_count",
  "webhook_state_coherence_count",
  "max_items_per_order",
  "max_orders_per_buyer",
  "max_orders_per_current_seller",
  "max_payment_events_per_order",
  "max_quotes_per_order",
  "max_reservations_per_buyer",
]);

const REVIEWED_MAIN_REF = "refs/heads/main";
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function required(env, name) {
  const value = env?.[name];
  if (typeof value !== "string" || value === "" || value !== value.trim()) {
    throw new Error(`${name} is required without surrounding whitespace`);
  }
  return value;
}

export function parseOrderPaymentShippingLegacyInspectionConfig(env = process.env) {
  assertDeterministicPostgresEnvironment(
    env,
    "Order/payment/shipping legacy inspection",
  );
  if (
    env.GITHUB_ACTIONS !== "true"
    || env.GITHUB_EVENT_NAME !== "workflow_dispatch"
    || env.GITHUB_REF !== REVIEWED_MAIN_REF
  ) {
    throw new Error(
      "Order/payment/shipping legacy inspection requires a manual main-branch GitHub Actions dispatch",
    );
  }
  const releaseCommit = required(
    env,
    "ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_RELEASE_COMMIT",
  );
  if (
    !COMMIT_PATTERN.test(releaseCommit)
    || releaseCommit !== required(env, "GITHUB_SHA")
  ) {
    throw new Error(
      "Order/payment/shipping legacy inspection commit must match the dispatched main commit",
    );
  }
  if (
    env.ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_CONFIRM
      !== ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_CONFIRMATION
  ) {
    throw new Error(
      "Order/payment/shipping legacy inspection confirmation is not exact",
    );
  }
  if (
    env.ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITES_CONFIRMED
      !== ORDER_PAYMENT_SHIPPING_LEGACY_PREREQUISITE_CONFIRMATION
  ) {
    throw new Error(
      "Order/payment/shipping legacy inspection prerequisites are not explicitly confirmed",
    );
  }
  for (const forbidden of [
    "DATABASE_URL",
    "DIRECT_UPLOAD_CLEANUP_DATABASE_URL",
    "GRANT_AUDIT_DATABASE_URL",
  ]) {
    if (Object.hasOwn(env, forbidden)) {
      throw new Error(
        "runtime, cleanup and grant-audit URLs must remain absent from the owner-only inspection job",
      );
    }
  }

  const directUrl = required(env, "DIRECT_URL");
  const directUrlSha256 = createHash("sha256")
    .update(directUrl, "utf8")
    .digest("hex");
  const expectedDigest = required(
    env,
    "PRODUCTION_MIGRATION_DIRECT_URL_SHA256",
  );
  if (
    !SHA256_PATTERN.test(expectedDigest)
    || directUrlSha256 !== expectedDigest
  ) {
    throw new Error("DIRECT_URL does not match the protected Production digest");
  }

  const identity = parseGuardedNeonDatabaseIdentity(directUrl, "DIRECT_URL");
  const target = REVIEWED_ORDER_PAYMENT_SHIPPING_INSPECTION_TARGET;
  if (
    identity.isPooler
    || identity.databaseName !== target.databaseName
    || identity.endpointId !== target.endpointId
    || identity.region !== target.region
    || identity.username !== target.ownerRole
    || required(env, "MIGRATION_DB_ROLE") !== target.ownerRole
    || required(env, "RUNTIME_DB_ROLE") !== target.runtimeRole
  ) {
    throw new Error("DIRECT_URL is not the reviewed direct production owner target");
  }

  const runnerTemp = path.resolve(required(env, "RUNNER_TEMP"));
  const evidencePath = path.resolve(
    required(env, "ORDER_PAYMENT_SHIPPING_LEGACY_INSPECT_EVIDENCE_PATH"),
  );
  const expectedPath = path.join(
    runnerTemp,
    `order-payment-shipping-legacy-inspection-${releaseCommit}.json`,
  );
  if (evidencePath !== expectedPath || existsSync(evidencePath)) {
    throw new Error(
      "Order/payment/shipping legacy inspection evidence path is not fresh and exact",
    );
  }

  return Object.freeze({
    directUrl,
    directUrlSha256,
    evidencePath,
    identity,
    releaseCommit,
  });
}

export function readOrderPaymentShippingLegacyInspectionGitState(
  cwd = process.cwd(),
) {
  const run = (args) => execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return Object.freeze({
    head: run(["rev-parse", "HEAD"]),
    status: run(["status", "--porcelain=v1", "--untracked-files=all"]),
  });
}

export function assertOrderPaymentShippingLegacyInspectionGitState(
  state,
  releaseCommit,
) {
  if (state?.head !== releaseCommit || state.status !== "") {
    throw new Error(
      "Order/payment/shipping legacy inspection checkout is not the exact clean dispatched commit",
    );
  }
  return Object.freeze({ clean: true, head: state.head });
}

export function normalizeOrderPaymentShippingLegacyCounts(row) {
  if (!row || typeof row !== "object") {
    throw new TypeError("Order/payment/shipping legacy inspection returned no count row");
  }
  const actualFields = Object.keys(row).sort();
  const expectedFields = [...ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS].sort();
  if (JSON.stringify(actualFields) !== JSON.stringify(expectedFields)) {
    throw new TypeError(
      "Order/payment/shipping legacy inspection returned an unexpected count shape",
    );
  }
  const normalized = {};
  for (const field of ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS) {
    const value = Number(row[field]);
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(
        `Order/payment/shipping legacy inspection returned invalid ${field}`,
      );
    }
    normalized[field] = value;
  }
  return Object.freeze(normalized);
}

async function readPosture(client) {
  const result = await client.query(
    `
      SELECT
        relation.relname AS table_name,
        pg_catalog.pg_get_userbyid(relation.relowner) AS owner_name,
        relation.relrowsecurity AS rls_enabled,
        relation.relforcerowsecurity AS rls_forced,
        (
          SELECT pg_catalog.count(*)::integer
          FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation.oid
        ) AS policy_count,
        pg_catalog.has_table_privilege(
          $1,
          relation.oid,
          'SELECT'
        ) AS runtime_can_select,
        pg_catalog.has_table_privilege(
          $1,
          relation.oid,
          'INSERT'
        ) AS runtime_can_insert,
        pg_catalog.has_table_privilege(
          $1,
          relation.oid,
          'UPDATE'
        ) AS runtime_can_update,
        pg_catalog.has_table_privilege(
          $1,
          relation.oid,
          'DELETE'
        ) AS runtime_can_delete
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
      WHERE namespace.nspname = 'public'
        AND relation.relkind = 'r'
        AND relation.relname = ANY($2::text[])
      ORDER BY relation.relname
    `,
    [
      REVIEWED_ORDER_PAYMENT_SHIPPING_INSPECTION_TARGET.runtimeRole,
      [...ORDER_PAYMENT_SHIPPING_INSPECTION_TABLES].sort(),
    ],
  );
  const expectedTables = [...ORDER_PAYMENT_SHIPPING_INSPECTION_TABLES].sort();
  if (
    result.rows.length !== expectedTables.length
    || result.rows.some((row, index) =>
      row.table_name !== expectedTables[index]
      || row.owner_name
        !== REVIEWED_ORDER_PAYMENT_SHIPPING_INSPECTION_TARGET.ownerRole
      || row.rls_enabled !== false
      || row.rls_forced !== false
      || Number(row.policy_count) !== 0
      || row.runtime_can_select !== true
      || row.runtime_can_insert !== true
      || row.runtime_can_update !== true
      || row.runtime_can_delete !== true
    )
  ) {
    throw new Error(
      "Order/payment/shipping legacy inspection database posture is not the reviewed broad-CRUD predecessor",
    );
  }
  return Object.freeze({
    tables: expectedTables,
    tableOwner: REVIEWED_ORDER_PAYMENT_SHIPPING_INSPECTION_TARGET.ownerRole,
    rlsEnabled: false,
    rlsForced: false,
    policyCountPerTable: 0,
    legacyRuntimeCrudRetained: true,
  });
}

export const ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL = `
  WITH order_seller_counts AS (
    SELECT
      item."orderId" AS order_id,
      pg_catalog.count(DISTINCT listing."sellerId")::integer AS seller_count
    FROM public."OrderItem" AS item
    JOIN public."Listing" AS listing ON listing.id = item."listingId"
    GROUP BY item."orderId"
  ), order_item_totals AS (
    SELECT
      item."orderId" AS order_id,
      pg_catalog.sum(item."priceCents"::bigint * item.quantity::bigint) AS item_total
    FROM public."OrderItem" AS item
    GROUP BY item."orderId"
  )
  SELECT
    (SELECT pg_catalog.count(*) FROM public."Order") AS order_count,
    (SELECT pg_catalog.count(*) FROM public."OrderItem") AS order_item_count,
    (SELECT pg_catalog.count(*) FROM public."OrderShippingRateQuote") AS shipping_quote_count,
    (SELECT pg_catalog.count(*) FROM public."OrderPaymentEvent") AS payment_event_count,
    (SELECT pg_catalog.count(*) FROM public."SellerPayoutEvent") AS payout_event_count,
    (SELECT pg_catalog.count(*) FROM public."CheckoutStockReservation") AS reservation_count,
    (SELECT pg_catalog.count(*) FROM public."StripeWebhookEvent") AS stripe_webhook_event_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."Order" AS orders
      WHERE NOT EXISTS (
        SELECT 1 FROM public."OrderItem" AS item WHERE item."orderId" = orders.id
      )
    ) AS order_without_item_count,
    (
      SELECT pg_catalog.count(*) FROM order_seller_counts WHERE seller_count <> 1
    ) AS order_multi_seller_count,
    (
      SELECT pg_catalog.count(DISTINCT orders.id)
      FROM public."Order" AS orders
      JOIN public."OrderItem" AS item ON item."orderId" = orders.id
      JOIN public."Listing" AS listing ON listing.id = item."listingId"
      JOIN public."SellerProfile" AS seller ON seller.id = listing."sellerId"
      WHERE orders."buyerId" IS NOT NULL
        AND orders."buyerId" = seller."userId"
    ) AS order_buyer_is_seller_count,
    (
      SELECT pg_catalog.count(*) FROM public."OrderItem" WHERE quantity <= 0
    ) AS item_invalid_quantity_count,
    (
      SELECT pg_catalog.count(*) FROM public."OrderItem" WHERE "priceCents" < 0
    ) AS item_invalid_price_count,
    (
      SELECT pg_catalog.count(*) FROM public."Order" WHERE currency !~ '^[a-z]{3}$'
    ) AS order_invalid_currency_count,
    (
      SELECT pg_catalog.count(*) FROM public."OrderPaymentEvent" WHERE currency !~ '^[a-z]{3}$'
    ) AS payment_invalid_currency_count,
    (
      SELECT pg_catalog.count(*) FROM public."SellerPayoutEvent" WHERE currency !~ '^[a-z]{3}$'
    ) AS payout_invalid_currency_count,
    (
      SELECT pg_catalog.count(*) FROM public."OrderItem" WHERE "listingSnapshot" IS NULL
    ) AS item_missing_snapshot_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."OrderItem"
      WHERE "listingSnapshot" IS NOT NULL
        AND (
          pg_catalog.jsonb_typeof("listingSnapshot") <> 'object'
          OR pg_catalog.jsonb_typeof("listingSnapshot"->'title') <> 'string'
          OR pg_catalog.jsonb_typeof("listingSnapshot"->'priceCents') <> 'number'
          OR pg_catalog.jsonb_typeof("listingSnapshot"->'imageUrls') <> 'array'
          OR pg_catalog.jsonb_typeof("listingSnapshot"->'sellerName') <> 'string'
          OR pg_catalog.jsonb_typeof("listingSnapshot"->'capturedAt') <> 'string'
        )
    ) AS item_invalid_snapshot_shape_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."OrderItem"
      WHERE "selectedVariants" IS NOT NULL
        AND pg_catalog.jsonb_typeof("selectedVariants") <> 'array'
    ) AS item_invalid_variants_shape_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."Order" AS orders
      LEFT JOIN order_item_totals AS totals ON totals.order_id = orders.id
      WHERE orders."itemsSubtotalCents"::bigint
        <> COALESCE(totals.item_total, 0::bigint)
    ) AS order_subtotal_mismatch_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."Order"
      WHERE "buyerDataPurgedAt" IS NOT NULL
        AND (
          "buyerEmail" IS NOT NULL OR "buyerName" IS NOT NULL
          OR "shipToLine1" IS NOT NULL OR "shipToLine2" IS NOT NULL
          OR "shipToCity" IS NOT NULL OR "shipToState" IS NOT NULL
          OR "shipToPostalCode" IS NOT NULL OR "shipToCountry" IS NOT NULL
          OR "quotedToName" IS NOT NULL OR "quotedToPhone" IS NOT NULL
          OR "quotedToLine1" IS NOT NULL OR "quotedToLine2" IS NOT NULL
          OR "quotedToCity" IS NOT NULL OR "quotedToState" IS NOT NULL
          OR "quotedToPostalCode" IS NOT NULL OR "quotedToCountry" IS NOT NULL
          OR "giftNote" IS NOT NULL
        )
    ) AS purged_order_retains_pii_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."Order"
      WHERE "fulfillmentStatus" IN ('READY_FOR_PICKUP', 'PICKED_UP')
        AND (
          "fulfillmentMethod" IS DISTINCT FROM 'PICKUP'::public."FulfillmentMethod"
          OR ("fulfillmentStatus" = 'READY_FOR_PICKUP' AND "pickupReadyAt" IS NULL)
          OR ("fulfillmentStatus" = 'PICKED_UP' AND "pickedUpAt" IS NULL)
        )
    ) AS pickup_state_invalid_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."Order"
      WHERE "fulfillmentStatus" IN ('SHIPPED', 'DELIVERED')
        AND (
          "fulfillmentMethod" IS DISTINCT FROM 'SHIPPING'::public."FulfillmentMethod"
          OR "shippedAt" IS NULL
          OR ("fulfillmentStatus" = 'DELIVERED' AND "deliveredAt" IS NULL)
        )
    ) AS shipping_state_invalid_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."Order"
      WHERE ("pickupReadyAt" IS NOT NULL AND "pickedUpAt" < "pickupReadyAt")
        OR ("shippedAt" IS NOT NULL AND "deliveredAt" < "shippedAt")
        OR ("paidAt" IS NOT NULL AND "paidAt" < "createdAt")
    ) AS fulfillment_timestamp_order_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."OrderShippingRateQuote"
      WHERE pg_catalog.jsonb_typeof(rates) <> 'array'
        OR "expiresAt" <= "createdAt"
    ) AS quote_invalid_shape_count,
    (
      SELECT pg_catalog.count(*) FROM public."OrderPaymentEvent" WHERE "amountCents" < 0
    ) AS payment_negative_amount_count,
    (
      SELECT pg_catalog.count(*) FROM public."OrderPaymentEvent" WHERE "eventType" NOT IN ('REFUND', 'DISPUTE')
    ) AS payment_unknown_type_count,
    (
      SELECT pg_catalog.count(*) FROM public."OrderPaymentEvent" WHERE "updatedAt" <> "createdAt"
    ) AS payment_mutated_count,
    (
      SELECT pg_catalog.count(*) FROM public."SellerPayoutEvent" WHERE "amountCents" < 0
    ) AS payout_negative_amount_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."SellerPayoutEvent"
      WHERE "stripeEventId" IS NULL OR btrim("stripeEventId") = ''
    ) AS payout_source_missing_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."CheckoutStockReservation"
      WHERE "payloadHash" !~ '^[0-9a-f]{64}$'
    ) AS reservation_invalid_payload_hash_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."CheckoutStockReservation"
      WHERE pg_catalog.jsonb_typeof("reservedItems") <> 'array'
    ) AS reservation_invalid_items_shape_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."CheckoutStockReservation"
      WHERE "expiresAt" <= "createdAt"
        OR (status IN ('SESSION_CREATED', 'COMPLETED') AND "stripeSessionId" IS NULL)
        OR (status = 'RESTORED' AND ("restoredAt" IS NULL OR "restoreReason" IS NULL))
        OR (status <> 'RESTORED' AND ("restoredAt" IS NOT NULL OR "restoreReason" IS NOT NULL))
    ) AS reservation_state_coherence_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."CheckoutStockReservation"
      WHERE status IN ('RESERVED', 'SESSION_CREATED')
        AND "expiresAt" < pg_catalog.clock_timestamp() - INTERVAL '2 hours'
    ) AS stale_reservation_count,
    (
      SELECT pg_catalog.count(*)
      FROM public."StripeWebhookEvent"
      WHERE ("processedAt" IS NOT NULL AND "processingStartedAt" IS NULL)
        OR ("processedAt" IS NOT NULL AND "processedAt" < "createdAt")
        OR ("processedAt" IS NOT NULL AND "lastError" IS NOT NULL)
    ) AS webhook_state_coherence_count,
    (
      SELECT COALESCE(pg_catalog.max(item_count), 0)
      FROM (
        SELECT pg_catalog.count(*)::integer AS item_count
        FROM public."OrderItem" GROUP BY "orderId"
      ) AS counts
    ) AS max_items_per_order,
    (
      SELECT COALESCE(pg_catalog.max(order_count), 0)
      FROM (
        SELECT pg_catalog.count(*)::integer AS order_count
        FROM public."Order" WHERE "buyerId" IS NOT NULL GROUP BY "buyerId"
      ) AS counts
    ) AS max_orders_per_buyer,
    (
      SELECT COALESCE(pg_catalog.max(order_count), 0)
      FROM (
        SELECT listing."sellerId", pg_catalog.count(DISTINCT item."orderId")::integer AS order_count
        FROM public."OrderItem" AS item
        JOIN public."Listing" AS listing ON listing.id = item."listingId"
        GROUP BY listing."sellerId"
      ) AS counts
    ) AS max_orders_per_current_seller,
    (
      SELECT COALESCE(pg_catalog.max(event_count), 0)
      FROM (
        SELECT pg_catalog.count(*)::integer AS event_count
        FROM public."OrderPaymentEvent" GROUP BY "orderId"
      ) AS counts
    ) AS max_payment_events_per_order,
    (
      SELECT COALESCE(pg_catalog.max(quote_count), 0)
      FROM (
        SELECT pg_catalog.count(*)::integer AS quote_count
        FROM public."OrderShippingRateQuote" GROUP BY "orderId"
      ) AS counts
    ) AS max_quotes_per_order,
    (
      SELECT COALESCE(pg_catalog.max(reservation_count), 0)
      FROM (
        SELECT pg_catalog.count(*)::integer AS reservation_count
        FROM public."CheckoutStockReservation"
        WHERE "buyerId" IS NOT NULL
        GROUP BY "buyerId"
      ) AS counts
    ) AS max_reservations_per_buyer
`;

async function readCounts(client) {
  const result = await client.query(ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL);
  if (result.rows.length !== 1) {
    throw new Error(
      "Order/payment/shipping legacy inspection did not return exactly one aggregate row",
    );
  }
  return normalizeOrderPaymentShippingLegacyCounts(result.rows[0]);
}

export async function runOrderPaymentShippingLegacyInspection(config) {
  const parsedUrl = new URL(config.directUrl);
  const client = new Client({
    application_name: "grainline-order-payment-shipping-legacy-inspection",
    connectionString: config.directUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 55_000,
    statement_timeout: 50_000,
    ...postgresChannelBindingClientOptions(parsedUrl),
  });
  await client.connect();
  let transactionOpen = false;
  try {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const transaction = await client.query(
      `SELECT pg_catalog.current_setting('transaction_read_only') AS read_only`,
    );
    if (transaction.rows[0]?.read_only !== "on") {
      throw new Error("Order/payment/shipping legacy inspection transaction is not read-only");
    }
    const posture = await readPosture(client);
    const counts = await readCounts(client);
    await client.query("ROLLBACK");
    transactionOpen = false;
    return Object.freeze({
      counts,
      directUrlSha256: config.directUrlSha256,
      posture,
      releaseCommit: config.releaseCommit,
      retained: Object.freeze({
        addresses: false,
        credentials: false,
        objectIds: false,
        providerIds: false,
        rawRows: false,
        snapshots: false,
        userIds: false,
      }),
      transaction: Object.freeze({ isolation: "repeatable read", readOnly: true }),
    });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end();
  }
}

export function writeOrderPaymentShippingLegacyInspectionEvidence(filePath, evidence) {
  const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
  if (
    /postgres(?:ql)?:\/\/|DIRECT_URL|password|buyerEmail|shipTo|quotedTo|stripe(?:Session|Charge|PaymentIntent|Transfer|Payout|Event)Id|listingSnapshot|reservedItems/i
      .test(serialized)
  ) {
    throw new Error(
      "Order/payment/shipping legacy inspection evidence contains forbidden data",
    );
  }
  const handle = openSync(filePath, "wx", 0o600);
  try {
    writeFileSync(handle, serialized, "utf8");
    fsyncSync(handle);
  } finally {
    closeSync(handle);
  }
  chmodSync(filePath, 0o600);
  const stat = lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o077) !== 0) {
    throw new Error(
      "Order/payment/shipping legacy inspection evidence is not a private regular file",
    );
  }
}

async function main() {
  try {
    const config = parseOrderPaymentShippingLegacyInspectionConfig(process.env);
    const git = assertOrderPaymentShippingLegacyInspectionGitState(
      readOrderPaymentShippingLegacyInspectionGitState(),
      config.releaseCommit,
    );
    const result = await runOrderPaymentShippingLegacyInspection(config);
    const evidence = Object.freeze({
      generatedAt: new Date().toISOString(),
      git,
      status: "passed",
      ...result,
    });
    writeOrderPaymentShippingLegacyInspectionEvidence(
      config.evidencePath,
      evidence,
    );
    process.stdout.write(`${JSON.stringify({
      counts: evidence.counts,
      evidenceWritten: true,
      posture: evidence.posture,
      releaseCommit: evidence.releaseCommit,
      retained: evidence.retained,
      status: evidence.status,
      transaction: evidence.transaction,
    })}\n`);
  } catch {
    process.stderr.write(
      "Order/payment/shipping legacy inspection failed closed.\n",
    );
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
