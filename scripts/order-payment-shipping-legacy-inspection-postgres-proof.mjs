#!/usr/bin/env node
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  ORDER_FULFILLMENT_TIMESTAMP_INVALID_PREDICATE,
  ORDER_PAYMENT_EVENT_DISPUTE_SOURCE_INVALID_PREDICATE,
  ORDER_PAYMENT_EVENT_LOCAL_SOURCE_INVALID_PREDICATE,
  ORDER_PAYMENT_EVENT_PROVIDER_TIME_EXPRESSION,
  ORDER_PAYMENT_EVENT_REFUND_SOURCE_INVALID_PREDICATE,
  ORDER_PAYMENT_EVENT_SIGNED_SOURCE_INVALID_PREDICATE,
  ORDER_PICKUP_STATE_INVALID_PREDICATE,
  ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS,
  ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
  STRIPE_WEBHOOK_STATE_INVALID_PREDICATE,
  normalizeOrderPaymentShippingLegacyCounts,
} from "./order-payment-shipping-legacy-inspect.mjs";

const { Client } = pg;

const DATABASE_NAME = "grainline_ci";
const PROOF_ENV = "ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_PROOF_DATABASE_URL";

function safeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/gi, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/gi,
      "$1[redacted-credentials]@",
    );
}

function applicationUrl(databaseUrl) {
  const parsed = new URL(databaseUrl);
  parsed.searchParams.set(
    "application_name",
    "grainline-order-payment-shipping-legacy-inspection-proof",
  );
  return parsed.toString();
}

export function parseOrderPaymentShippingLegacyInspectionProofConfig(
  env = process.env,
) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(
    parsed.protocol,
    "postgresql:",
    "Order/payment/shipping legacy inspection proof requires PostgreSQL",
  );
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Order/payment/shipping legacy inspection proof refuses a non-loopback database",
  );
  assert.equal(
    parsed.pathname,
    `/${DATABASE_NAME}`,
    `Order/payment/shipping legacy inspection proof requires the ${DATABASE_NAME} database`,
  );
  return Object.freeze({ databaseUrl });
}

export async function runOrderPaymentShippingLegacyInspectionProof(
  databaseUrl,
) {
  const client = new Client({
    connectionString: applicationUrl(databaseUrl),
    connectionTimeoutMillis: 5_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
  let counts;
  let transactionOpen = false;
  try {
    await client.connect();
    const identity = await client.query(`
      SELECT
        CURRENT_USER AS current_user,
        pg_catalog.current_database() AS database_name
    `);
    assert.deepEqual(identity.rows, [
      {
        current_user: "ci",
        database_name: DATABASE_NAME,
      },
    ]);
    await client.query(
      "BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY",
    );
    transactionOpen = true;
    const readOnly = await client.query(
      "SELECT pg_catalog.current_setting('transaction_read_only') AS value",
    );
    assert.equal(
      readOnly.rows[0]?.value,
      "on",
      "Order/payment/shipping legacy inspection proof transaction is not read-only",
    );
    const timestampSemantics = await client.query(`
      WITH order_fixtures(
        "pickupReadyAt",
        "pickedUpAt",
        "shippedAt",
        "deliveredAt",
        "createdAt",
        "paidAt"
      ) AS (
        VALUES
          (
            NULL::timestamp,
            NULL::timestamp,
            NULL::timestamp,
            NULL::timestamp,
            TIMESTAMP '2026-08-05 00:00:00.001',
            TIMESTAMP '2026-08-05 00:00:00.000'
          ),
          (
            TIMESTAMP '2026-08-05 00:00:01.001',
            TIMESTAMP '2026-08-05 00:00:01.000',
            NULL::timestamp,
            NULL::timestamp,
            TIMESTAMP '2026-08-05 00:00:00.001',
            TIMESTAMP '2026-08-05 00:00:00.000'
          ),
          (
            NULL::timestamp,
            NULL::timestamp,
            TIMESTAMP '2026-08-05 00:00:02.001',
            TIMESTAMP '2026-08-05 00:00:02.000',
            TIMESTAMP '2026-08-05 00:00:00.001',
            TIMESTAMP '2026-08-05 00:00:00.000'
          )
      ), pickup_fixtures(
        "fulfillmentMethod",
        "fulfillmentStatus",
        "pickupReadyAt",
        "pickedUpAt"
      ) AS (
        VALUES
          (
            'PICKUP'::public."FulfillmentMethod",
            'PICKED_UP'::public."FulfillmentStatus",
            TIMESTAMP '2026-08-05 00:00:00.000',
            TIMESTAMP '2026-08-05 00:00:00.001'
          ),
          (
            'PICKUP'::public."FulfillmentMethod",
            'PICKED_UP'::public."FulfillmentStatus",
            NULL::timestamp,
            TIMESTAMP '2026-08-05 00:00:00.001'
          ),
          (
            'PICKUP'::public."FulfillmentMethod",
            'PICKED_UP'::public."FulfillmentStatus",
            TIMESTAMP '2026-08-05 00:00:00.000',
            NULL::timestamp
          ),
          (
            'SHIPPING'::public."FulfillmentMethod",
            'READY_FOR_PICKUP'::public."FulfillmentStatus",
            TIMESTAMP '2026-08-05 00:00:00.000',
            NULL::timestamp
          )
      ), webhook_fixtures(
        "processingStartedAt",
        "processedAt",
        "createdAt",
        "lastError"
      ) AS (
        VALUES
          (
            TIMESTAMP '2026-08-05 00:00:00.000',
            TIMESTAMP '2026-08-05 00:00:00.001',
            TIMESTAMP '2026-08-05 00:00:00.002',
            NULL::text
          ),
          (
            TIMESTAMP '2026-08-05 00:00:01.001',
            TIMESTAMP '2026-08-05 00:00:01.000',
            TIMESTAMP '2026-08-05 00:00:00.999',
            NULL::text
          ),
          (
            NULL::timestamp,
            TIMESTAMP '2026-08-05 00:00:02.000',
            TIMESTAMP '2026-08-05 00:00:01.999',
            NULL::text
          ),
          (
            TIMESTAMP '2026-08-05 00:00:03.000',
            TIMESTAMP '2026-08-05 00:00:03.001',
            TIMESTAMP '2026-08-05 00:00:03.000',
            'legacy error'::text
          )
      )
      SELECT
        (
          SELECT pg_catalog.count(*)
          FROM order_fixtures
          WHERE ${ORDER_FULFILLMENT_TIMESTAMP_INVALID_PREDICATE}
        )::integer AS invalid_order_timestamps,
        (
          SELECT pg_catalog.count(*)
          FROM webhook_fixtures
          WHERE ${STRIPE_WEBHOOK_STATE_INVALID_PREDICATE}
        )::integer AS invalid_webhook_states,
        (
          SELECT pg_catalog.count(*)
          FROM pickup_fixtures
          WHERE ${ORDER_PICKUP_STATE_INVALID_PREDICATE}
        )::integer AS invalid_pickup_states
    `);
    assert.deepEqual(timestampSemantics.rows, [
      {
        invalid_order_timestamps: 2,
        invalid_pickup_states: 3,
        invalid_webhook_states: 3,
      },
    ]);
    const paymentEventSemantics = await client.query(`
      WITH event_fixtures(
        fixture_name,
        "orderId",
        "stripeEventId",
        "stripeObjectId",
        "stripeObjectType",
        "eventType",
        "amountCents",
        currency,
        status,
        reason,
        description,
        metadata,
        "stripeEventCreatedSeconds"
      ) AS (
        VALUES
          (
            'valid_signed_refund', 'order-a', 'evt_valid_refund', 're_valid',
            'refund', 'REFUND', 100, 'usd', 'succeeded', NULL::text,
            NULL::text, '{"stripeEventType":"charge.refunded"}'::jsonb,
            100::bigint
          ),
          (
            'invalid_signed_refund', 'order-a', 'evt_invalid_refund',
            're_invalid_signed', 'refund', 'REFUND', 100, 'usd', 'succeeded',
            NULL::text, NULL::text,
            '{"stripeEventType":"charge.dispute.created"}'::jsonb,
            101::bigint
          ),
          (
            'invalid_signed_dispute', 'order-a', 'evt_invalid_signed_dispute',
            'dp_invalid_signed', 'dispute', 'DISPUTE', 100, 'usd',
            'needs_response', 'fraudulent', NULL::text, '{}'::jsonb,
            102::bigint
          ),
          (
            'valid_local_refund', 'order-a',
            'local:seller_refund_recorded:re_local', 're_local', 'refund',
            'REFUND', 100, 'usd', 'succeeded', NULL::text, NULL::text,
            '{"localAction":"SELLER_REFUND_RECORDED"}'::jsonb, NULL::bigint
          ),
          (
            'invalid_local_identity', 'order-a',
            'local:seller_refund_recorded:wrong', 're_local_identity',
            'refund', 'REFUND', 100, 'usd', 'succeeded', NULL::text,
            NULL::text, '{"localAction":"SELLER_REFUND_RECORDED"}'::jsonb,
            NULL::bigint
          ),
          (
            'invalid_local_clock', 'order-a',
            'local:case_refund_recorded:re_local_clock', 're_local_clock',
            'refund', 'REFUND', 100, 'usd', 'succeeded', NULL::text,
            NULL::text, '{"localAction":"CASE_REFUND_RECORDED"}'::jsonb,
            102::bigint
          ),
          (
            'valid_dispute_first', 'order-a', 'evt_dispute_first', 'dp_valid',
            'dispute', 'DISPUTE', 100, 'usd', 'needs_response', 'fraudulent',
            NULL::text,
            '{"stripeEventType":"charge.dispute.created"}'::jsonb,
            200::bigint
          ),
          (
            'valid_dispute_conflict', 'order-a', 'evt_dispute_conflict',
            'dp_valid', 'dispute', 'DISPUTE', 100, 'usd', 'won', 'fraudulent',
            NULL::text,
            '{"stripeEventType":"charge.dispute.updated"}'::jsonb,
            200::bigint
          ),
          (
            'invalid_dispute', 'order-a', 'evt_invalid_dispute',
            'dp_invalid', 'dispute', 'DISPUTE', 100, 'usd', NULL::text,
            'fraudulent', NULL::text,
            '{"stripeEventType":"charge.dispute.created"}'::jsonb,
            201::bigint
          ),
          (
            'cross_order_first', 'order-a', 'evt_cross_first', 're_cross',
            'refund', 'REFUND', 100, 'usd', 'succeeded', NULL::text,
            NULL::text, '{"stripeEventType":"charge.refunded"}'::jsonb,
            300::bigint
          ),
          (
            'cross_order_second', 'order-b', 'evt_cross_second', 're_cross',
            'refund', 'REFUND', 100, 'usd', 'succeeded', NULL::text,
            NULL::text, '{"stripeEventType":"charge.refunded"}'::jsonb,
            301::bigint
          ),
          (
            'blank_identity', 'order-a', ' ', 're_blank_identity', 'refund',
            'REFUND', 100, 'usd', 'succeeded', NULL::text, NULL::text,
            '{"stripeEventType":"charge.refunded"}'::jsonb, 400::bigint
          ),
          (
            'incomplete_object', 'order-a', 'evt_incomplete_object',
            NULL::text, 'refund', 'REFUND', 100, 'usd', 'succeeded',
            NULL::text, NULL::text,
            '{"stripeEventType":"charge.refunded"}'::jsonb, 401::bigint
          ),
          (
            'blank_optional', 'order-a', 'evt_blank_optional',
            're_blank_optional', 'refund', 'REFUND', 100, 'usd', ' ',
            NULL::text, NULL::text,
            '{"stripeEventType":"charge.refunded"}'::jsonb, 402::bigint
          ),
          (
            'unknown_source', 'order-a', 'historical:unknown',
            're_unknown_source', 'refund', 'REFUND', 100, 'usd', 'succeeded',
            NULL::text, NULL::text,
            '{"stripeEventType":"charge.refunded"}'::jsonb, 403::bigint
          )
      ), payment_object_order_counts AS (
        SELECT
          event."stripeObjectType" AS object_type,
          event."stripeObjectId" AS object_id,
          pg_catalog.count(DISTINCT event."orderId")::integer AS order_count
        FROM event_fixtures AS event
        WHERE event."stripeObjectType" IS NOT NULL
          AND pg_catalog.btrim(event."stripeObjectType") <> ''
          AND event."stripeObjectId" IS NOT NULL
          AND pg_catalog.btrim(event."stripeObjectId") <> ''
        GROUP BY event."stripeObjectType", event."stripeObjectId"
      ), payment_dispute_same_second_counts AS (
        SELECT
          event."orderId" AS order_id,
          event."stripeObjectId" AS object_id,
          (${ORDER_PAYMENT_EVENT_PROVIDER_TIME_EXPRESSION}) AS event_second,
          pg_catalog.count(DISTINCT (
            event."amountCents",
            event.currency,
            event.status,
            event.reason,
            event.metadata->>'stripeEventType'
          ))::integer AS canonical_state_count
        FROM event_fixtures AS event
        WHERE event."eventType" = 'DISPUTE'
          AND event."stripeObjectId" IS NOT NULL
          AND (${ORDER_PAYMENT_EVENT_PROVIDER_TIME_EXPRESSION}) IS NOT NULL
        GROUP BY
          event."orderId",
          event."stripeObjectId",
          (${ORDER_PAYMENT_EVENT_PROVIDER_TIME_EXPRESSION})
      )
      SELECT
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name IN (
            'valid_signed_refund',
            'valid_dispute_first',
            'valid_dispute_conflict'
          )
            AND (${ORDER_PAYMENT_EVENT_SIGNED_SOURCE_INVALID_PREDICATE})
        )::integer AS valid_signed_rejected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name IN (
            'invalid_signed_refund',
            'invalid_signed_dispute'
          )
            AND (${ORDER_PAYMENT_EVENT_SIGNED_SOURCE_INVALID_PREDICATE})
        )::integer AS invalid_signed_rejected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name = 'valid_local_refund'
            AND (${ORDER_PAYMENT_EVENT_LOCAL_SOURCE_INVALID_PREDICATE})
        )::integer AS valid_local_rejected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name IN ('invalid_local_identity', 'invalid_local_clock')
            AND (${ORDER_PAYMENT_EVENT_LOCAL_SOURCE_INVALID_PREDICATE})
        )::integer AS invalid_local_rejected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name IN ('valid_dispute_first', 'valid_dispute_conflict')
            AND (${ORDER_PAYMENT_EVENT_DISPUTE_SOURCE_INVALID_PREDICATE})
        )::integer AS valid_dispute_rejected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name = 'invalid_dispute'
            AND (${ORDER_PAYMENT_EVENT_DISPUTE_SOURCE_INVALID_PREDICATE})
        )::integer AS invalid_dispute_rejected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name = 'valid_signed_refund'
            AND (${ORDER_PAYMENT_EVENT_REFUND_SOURCE_INVALID_PREDICATE})
        )::integer AS valid_refund_rejected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name = 'incomplete_object'
            AND (${ORDER_PAYMENT_EVENT_REFUND_SOURCE_INVALID_PREDICATE})
        )::integer AS invalid_refund_rejected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name = 'blank_identity'
            AND pg_catalog.btrim(event."stripeEventId") = ''
        )::integer AS blank_identity_detected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name = 'incomplete_object'
            AND (
              event."stripeObjectId" IS NULL
              OR pg_catalog.btrim(event."stripeObjectId") = ''
              OR event."stripeObjectType" IS NULL
              OR pg_catalog.btrim(event."stripeObjectType") = ''
            )
        )::integer AS incomplete_object_detected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name = 'blank_optional'
            AND (
              (event.status IS NOT NULL AND pg_catalog.btrim(event.status) = '')
              OR (event.reason IS NOT NULL AND pg_catalog.btrim(event.reason) = '')
              OR (
                event.description IS NOT NULL
                AND pg_catalog.btrim(event.description) = ''
              )
            )
        )::integer AS blank_optional_detected,
        pg_catalog.count(*) FILTER (
          WHERE event.fixture_name = 'unknown_source'
            AND event."stripeEventId" NOT LIKE 'evt\\_%' ESCAPE '\\'
            AND event."stripeEventId" NOT LIKE 'local:%'
        )::integer AS unknown_source_detected,
        (
          SELECT pg_catalog.count(*)
          FROM payment_object_order_counts
          WHERE order_count > 1
        )::integer AS cross_order_object_detected,
        (
          SELECT pg_catalog.count(*)
          FROM payment_dispute_same_second_counts
          WHERE canonical_state_count > 1
        )::integer AS same_second_dispute_conflict_detected
      FROM event_fixtures AS event
    `);
    assert.deepEqual(paymentEventSemantics.rows, [
      {
        blank_identity_detected: 1,
        blank_optional_detected: 1,
        cross_order_object_detected: 1,
        incomplete_object_detected: 1,
        invalid_dispute_rejected: 1,
        invalid_local_rejected: 2,
        invalid_refund_rejected: 1,
        invalid_signed_rejected: 2,
        same_second_dispute_conflict_detected: 1,
        unknown_source_detected: 1,
        valid_dispute_rejected: 0,
        valid_local_rejected: 0,
        valid_refund_rejected: 0,
        valid_signed_rejected: 0,
      },
    ]);
    const result = await client.query(
      ORDER_PAYMENT_SHIPPING_LEGACY_INSPECTION_SQL,
    );
    assert.equal(
      result.rows.length,
      1,
      "Order/payment/shipping legacy inspection proof returned an unexpected row count",
    );
    counts = normalizeOrderPaymentShippingLegacyCounts(result.rows[0]);
    await client.query("ROLLBACK");
    transactionOpen = false;
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    await client.end().catch(() => {});
  }
  return Object.freeze({
    aggregateFieldCount: ORDER_PAYMENT_SHIPPING_LEGACY_COUNT_FIELDS.length,
    database: "loopback/grainline_ci",
    productionChanged: false,
    queryExecuted: true,
    schemaAccepted: true,
    paymentEventSemanticsAccepted: true,
    timestampSemanticsAccepted: true,
    zeroRowDatabase: Object.values(counts).every((value) => value === 0),
  });
}

async function main() {
  const config = parseOrderPaymentShippingLegacyInspectionProofConfig(
    process.env,
  );
  const result = await runOrderPaymentShippingLegacyInspectionProof(
    config.databaseUrl,
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  main().catch((error) => {
    process.stderr.write(`${safeError(error)}\n`);
    process.exitCode = 1;
  });
}
