#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

import {
  orderPaymentSignedRefundIdentityFunctionSource,
} from "./build-order-payment-signed-refund-identity-migration.mjs";
import {
  proveOrderPaymentSignedRefundIdentityRuntimeBoundaries,
  proveOrderPaymentSignedRefundIdentityRuntimeCatalog,
  verifyOrderPaymentSignedRefundIdentityRuntimeIdentity,
} from "./order-payment-signed-refund-identity-production-postflight.mjs";

const { Client } = pg;

const OWNER_DATABASE_ENV =
  "ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PROOF_DATABASE_URL";
const RUNTIME_DATABASE_ENV =
  "ORDER_PAYMENT_SIGNED_REFUND_IDENTITY_PROOF_RUNTIME_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const FUNCTION_IDENTITY =
  "public.grainline_order_payment_signed_refund_apply(text,bigint,text,bigint,integer,text,text,integer,text,bigint,text)";

function parseLoopbackUrl(value, label, expectedRole) {
  assert.ok(value, `${label} is required`);
  const parsed = new URL(value);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    `${label} refuses a non-loopback database`,
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), expectedRole);
  assert.ok(parsed.password, `${label} requires a password`);
  return value;
}

export function parseOrderPaymentSignedRefundIdentityProofConfig(
  env = process.env,
) {
  return Object.freeze({
    ownerDatabaseUrl: parseLoopbackUrl(
      env[OWNER_DATABASE_ENV],
      OWNER_DATABASE_ENV,
      OWNER_ROLE,
    ),
    runtimeDatabaseUrl: parseLoopbackUrl(
      env[RUNTIME_DATABASE_ENV],
      RUNTIME_DATABASE_ENV,
      RUNTIME_ROLE,
    ),
  });
}

function fixtureIds(label) {
  const suffix = randomUUID().replaceAll("-", "");
  return Object.freeze({
    label,
    buyerId: `user_refund_identity_buyer_${suffix}`,
    sellerUserId: `user_refund_identity_seller_${suffix}`,
    sellerProfileId: `seller_refund_identity_${suffix}`,
    orderId: `order_refund_identity_${suffix}`,
    chargeId: `ch_refundidentity${suffix}`,
    refundId: `re_refundidentity${suffix}`,
    localPaymentId: `local-refund-identity-payment-${suffix}`,
    localAuditId: `local-refund-identity-audit-${suffix}`,
    signedPaymentId: null,
    signedAuditId: null,
    eventId: `evt_refundidentity${suffix}`,
  });
}

async function insertFixture(owner, ids, {
  action = "BLOCKED_CHECKOUT_REFUND_RECORDED",
  reason = "blocked_checkout",
  includeAudit = true,
  amount = 11800,
} = {}) {
  await owner.query("BEGIN");
  try {
    await owner.query(`
      INSERT INTO public."User" (
        id, "clerkId", email, name, "createdAt", "updatedAt"
      ) VALUES
        ($1, $2, $3, 'Refund identity proof buyer', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
        ($4, $5, $6, 'Refund identity proof seller', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
    `, [
      ids.buyerId,
      `clerk-${ids.buyerId}`,
      `${ids.buyerId}@example.invalid`,
      ids.sellerUserId,
      `clerk-${ids.sellerUserId}`,
      `${ids.sellerUserId}@example.invalid`,
    ]);
    await owner.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 'Refund identity proof seller',
        'refund identity proof seller', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.sellerProfileId, ids.sellerUserId]);
    await owner.query(`
      INSERT INTO public."Order" (
        id, "buyerId", "sellerProfileId", "stripeChargeId",
        "sellerRefundId", "sellerRefundAmountCents", "reviewNeeded", "reviewNote"
      ) VALUES ($1, $2, $3, $4, $5, $6, true, $7)
    `, [
      ids.orderId,
      ids.buyerId,
      ids.sellerProfileId,
      ids.chargeId,
      ids.refundId,
      amount,
      `preserve-${ids.label}`,
    ]);
    await owner.query(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES ($1, 'charge.refunded', $2, 7, CURRENT_TIMESTAMP)
    `, [ids.eventId, ids.chargeId]);
    await owner.query(`
      INSERT INTO public."OrderPaymentEvent" (
        id, "orderId", "stripeEventId", "stripeObjectId", "stripeObjectType",
        "eventType", "amountCents", currency, status, reason, description, metadata
      ) VALUES (
        $1, $2, $3::text, $4::text, 'refund', 'REFUND', $5, 'usd', 'succeeded',
        $6, 'Disposable exact local refund evidence.',
        pg_catalog.jsonb_build_object(
          'localAction', $7::text,
          'refundIds', pg_catalog.jsonb_build_array($4::text)
        )
      )
    `, [
      ids.localPaymentId,
      ids.orderId,
      `local:${action.toLowerCase()}:${ids.refundId}`,
      ids.refundId,
      amount,
      reason,
      action,
    ]);
    if (includeAudit) {
      await owner.query(`
        INSERT INTO public."SystemAuditLog" (
          id, "actorType", "actorId", action, "targetType", "targetId",
          reason, metadata
        ) VALUES (
          $1, 'system', $2, $3, 'ORDER', $4, $5,
          pg_catalog.jsonb_build_object(
            'orderPaymentEventId', $6::text,
            'stripeRefundId', $7::text,
            'amountCents', $8::integer,
            'currency', 'usd'
          )
        )
      `, [
        ids.localAuditId,
        ids.sellerUserId,
        action,
        ids.orderId,
        reason,
        ids.localPaymentId,
        ids.refundId,
        amount,
      ]);
    }
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function applyOmittedRefund(runtime, ids, { generation = 7, amount = 11800 } = {}) {
  const eventCreated = Math.floor(Date.now() / 1000) - 2;
  return (await runtime.query(`
    SELECT *
      FROM public.grainline_order_payment_signed_refund_apply(
        $1, $2, $3, $4, $5, 'usd', NULL, NULL, NULL, NULL, NULL
      )
  `, [ids.eventId, generation, ids.chargeId, eventCreated, amount])).rows[0];
}

async function removeFixture(owner, ids) {
  await owner.query("BEGIN");
  try {
    await owner.query(`
      DELETE FROM public."SystemAuditLog"
       WHERE "targetId" = $1 OR id = $2
    `, [ids.orderId, ids.localAuditId]);
    await owner.query(`
      DELETE FROM public."OrderPaymentEvent" WHERE "orderId" = $1
    `, [ids.orderId]);
    await owner.query(`
      DELETE FROM public."StripeWebhookEvent" WHERE id = $1
    `, [ids.eventId]);
    await owner.query(`DELETE FROM public."Order" WHERE id = $1`, [ids.orderId]);
    await owner.query(`DELETE FROM public."SellerProfile" WHERE id = $1`, [ids.sellerProfileId]);
    await owner.query(`DELETE FROM public."User" WHERE id IN ($1, $2)`, [ids.buyerId, ids.sellerUserId]);
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function proveProductionPostflightContract(runtime) {
  let transactionOpen = false;
  try {
    await runtime.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    transactionOpen = true;
    const transaction = (await runtime.query(`
      SELECT
        pg_catalog.current_setting('transaction_isolation') AS isolation,
        pg_catalog.current_setting('transaction_read_only') AS read_only
    `)).rows;
    assert.deepEqual(transaction, [{
      isolation: "repeatable read",
      read_only: "on",
    }]);
    await verifyOrderPaymentSignedRefundIdentityRuntimeIdentity(
      runtime,
      { databaseName: DATABASE_NAME, runtimeRole: RUNTIME_ROLE },
      OWNER_ROLE,
    );
    const catalog = await proveOrderPaymentSignedRefundIdentityRuntimeCatalog(
      runtime,
      OWNER_ROLE,
    );
    await proveOrderPaymentSignedRefundIdentityRuntimeBoundaries(runtime);
    await runtime.query("ROLLBACK");
    transactionOpen = false;
    return catalog;
  } finally {
    if (transactionOpen) await runtime.query("ROLLBACK").catch(() => {});
  }
}

export async function runOrderPaymentSignedRefundIdentityPostgresProof(
  env = process.env,
) {
  const { ownerDatabaseUrl, runtimeDatabaseUrl } =
    parseOrderPaymentSignedRefundIdentityProofConfig(env);
  const owner = new Client({ connectionString: ownerDatabaseUrl });
  const runtime = new Client({ connectionString: runtimeDatabaseUrl });
  const exact = fixtureIds("exact");
  const missingAudit = fixtureIds("missing-audit");
  await owner.connect();
  await runtime.connect();
  try {
    const [ownerIdentity, runtimeIdentity] = await Promise.all([
      owner.query("SELECT current_user AS current_user, current_database() AS database"),
      runtime.query("SELECT current_user AS current_user, current_database() AS database"),
    ]);
    assert.deepEqual(ownerIdentity.rows, [{ current_user: OWNER_ROLE, database: DATABASE_NAME }]);
    assert.deepEqual(runtimeIdentity.rows, [{ current_user: RUNTIME_ROLE, database: DATABASE_NAME }]);

    const catalog = (await owner.query(`
      SELECT
        routine.prosecdef AS security_definer,
        routine.proconfig AS config,
        routine.prosrc AS function_source,
        pg_catalog.has_function_privilege($1, routine.oid, 'EXECUTE') AS runtime_execute,
        EXISTS (
          SELECT 1
            FROM pg_catalog.aclexplode(
              COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
            ) AS acl
           WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = $2::pg_catalog.regprocedure
    `, [RUNTIME_ROLE, FUNCTION_IDENTITY])).rows[0];
    assert.equal(
      catalog.function_source,
      orderPaymentSignedRefundIdentityFunctionSource(),
    );
    assert.deepEqual({
      securityDefiner: catalog.security_definer,
      config: catalog.config,
      runtimeExecute: catalog.runtime_execute,
      publicExecute: catalog.public_execute,
    }, {
      securityDefiner: true,
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    });

    await insertFixture(owner, exact);
    const inserted = await applyOmittedRefund(runtime, exact);
    assert.equal(inserted.action, "inserted");
    assert.equal(inserted.orderId, exact.orderId);
    assert.equal(inserted.orderUpdated, false);
    const exactState = (await owner.query(`
      SELECT
        payment."stripeObjectId" AS refund_id,
        payment.reason,
        payment.metadata->>'localRefundEvidenceId' AS evidence_id,
        payment.metadata->>'localRefundEvidenceAction' AS evidence_action,
        orders."reviewNote" AS review_note
      FROM public."OrderPaymentEvent" AS payment
      JOIN public."Order" AS orders ON orders.id = payment."orderId"
      WHERE payment."stripeEventId" = $1
    `, [exact.eventId])).rows[0];
    assert.deepEqual(exactState, {
      refund_id: exact.refundId,
      reason: "local_refund_confirmed",
      evidence_id: exact.localPaymentId,
      evidence_action: "BLOCKED_CHECKOUT_REFUND_RECORDED",
      review_note: "preserve-exact",
    });
    const replay = await applyOmittedRefund(runtime, exact);
    assert.equal(replay.action, "replay");
    assert.equal(replay.paymentEventId, inserted.paymentEventId);
    await assert.rejects(
      applyOmittedRefund(runtime, exact, { generation: 8 }),
      /source lease is invalid/,
    );

    await insertFixture(owner, missingAudit, { includeAudit: false });
    const external = await applyOmittedRefund(runtime, missingAudit);
    assert.equal(external.action, "inserted");
    assert.equal(external.orderUpdated, true);
    const externalState = (await owner.query(`
      SELECT "stripeObjectId" AS refund_id, reason,
             metadata->>'localRefundEvidenceId' AS evidence_id
        FROM public."OrderPaymentEvent" WHERE "stripeEventId" = $1
    `, [missingAudit.eventId])).rows[0];
    assert.deepEqual(externalState, {
      refund_id: `external:${missingAudit.eventId}`,
      reason: "additional_external_refund",
      evidence_id: null,
    });

    const postflight = await proveProductionPostflightContract(runtime);

    return Object.freeze({
      phase: "order-payment-signed-refund-identity-proven",
      exactLocalIdentityDerived: true,
      missingAuditRejectedAsLocalIdentity: true,
      exactReplayProven: true,
      generationForgeryRejected: true,
      productionPostflightFunctionCount: postflight.functionCount,
      productionPostflightReadOnly: true,
      runtimeRole: RUNTIME_ROLE,
      productionTouched: false,
    });
  } finally {
    await removeFixture(owner, exact).catch(() => {});
    await removeFixture(owner, missingAudit).catch(() => {});
    await Promise.allSettled([owner.end(), runtime.end()]);
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runOrderPaymentSignedRefundIdentityPostgresProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Signed-refund identity PostgreSQL proof failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
