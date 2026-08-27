#!/usr/bin/env node

import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;

const OWNER_DATABASE_ENV =
  "BLOCKED_CHECKOUT_TRANSFER_BINDING_PROOF_DATABASE_URL";
const RUNTIME_DATABASE_ENV =
  "BLOCKED_CHECKOUT_TRANSFER_BINDING_PROOF_RUNTIME_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const OWNER_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const FUNCTION_IDENTITY =
  "public.grainline_blocked_checkout_transfer_bind(text,bigint,text,text,text,text,text)";

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

export function parseBlockedCheckoutTransferBindingProofConfig(
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

function fixtureIds() {
  const suffix = randomUUID().replaceAll("-", "");
  return Object.freeze({
    sellerUserId: `user_transfer_binding_${suffix}`,
    sellerProfileId: `seller_transfer_binding_${suffix}`,
    listingId: `listing_transfer_binding_${suffix}`,
    orderItemId: `item_transfer_binding_${suffix}`,
    eventId: `evt_transfer_binding_${suffix}`,
    sessionId: `cs_transfer_binding_${suffix}`,
    orderId: `order_transfer_binding_${suffix}`,
    paymentIntentId: `pi_transfer_binding_${suffix}`,
    chargeId: `ch_transfer_binding_${suffix}`,
    transferId: `tr_transfer_binding_${suffix}`,
  });
}

async function insertFixture(owner, ids, { refunded = false } = {}) {
  await owner.query("BEGIN");
  try {
    await owner.query(`
      INSERT INTO public."User" (
        id, "clerkId", email, name, "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, $3, 'Transfer binding proof seller',
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [
      ids.sellerUserId,
      `clerk-${ids.sellerUserId}`,
      `${ids.sellerUserId}@example.invalid`,
    ]);
    await owner.query(`
      INSERT INTO public."SellerProfile" (
        id, "userId", "displayName", "displayNameNormalized",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 'Transfer binding proof seller',
        'transfer binding proof seller', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.sellerProfileId, ids.sellerUserId]);
    await owner.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", title, description, "priceCents",
        "createdAt", "updatedAt"
      ) VALUES (
        $1, $2, 'Transfer binding proof listing',
        'Disposable transfer binding proof listing.', 1000,
        CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
      )
    `, [ids.listingId, ids.sellerProfileId]);
    await owner.query(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES ($1, 'checkout.session.completed', $2, 3, CURRENT_TIMESTAMP)
    `, [ids.eventId, ids.sessionId]);
    await owner.query(`
      INSERT INTO public."Order" (
        id,
        "sellerProfileId",
        "paidAt",
        "stripeSessionId",
        "stripePaymentIntentId",
        "stripeChargeId",
        "sellerRefundId",
        "sellerRefundLockedAt"
      ) VALUES (
        $1,
        $2,
        CURRENT_TIMESTAMP,
        $3,
        $4,
        $5,
        CASE WHEN $6::boolean THEN 're_already' ELSE NULL END,
        CASE WHEN $6::boolean THEN CURRENT_TIMESTAMP ELSE NULL END
      )
    `, [
      ids.orderId,
      ids.sellerProfileId,
      ids.sessionId,
      ids.paymentIntentId,
      ids.chargeId,
      refunded,
    ]);
    await owner.query(`
      INSERT INTO public."OrderItem" (
        id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents"
      ) VALUES ($1, $2, $3, $4, 1, 1000)
    `, [
      ids.orderItemId,
      ids.orderId,
      ids.listingId,
      ids.sellerProfileId,
    ]);
    await owner.query("COMMIT");
  } catch (error) {
    await owner.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

async function bind(runtime, ids, overrides = {}) {
  const input = { ...ids, generation: 3, ...overrides };
  return (await runtime.query(`
    SELECT public.grainline_blocked_checkout_transfer_bind(
      $1, $2, $3, $4, $5, $6, $7
    ) AS binding
  `, [
    input.eventId,
    input.generation,
    input.sessionId,
    input.orderId,
    input.paymentIntentId,
    input.chargeId,
    input.transferId,
  ])).rows[0]?.binding;
}

export async function runBlockedCheckoutTransferBindingPostgresProof(
  env = process.env,
) {
  const { ownerDatabaseUrl, runtimeDatabaseUrl } =
    parseBlockedCheckoutTransferBindingProofConfig(env);
  const owner = new Client({ connectionString: ownerDatabaseUrl });
  const runtime = new Client({ connectionString: runtimeDatabaseUrl });
  const exact = fixtureIds();
  const late = fixtureIds();
  await owner.connect();
  await runtime.connect();
  try {
    const identities = await Promise.all([
      owner.query(`
        SELECT current_user AS current_user, current_database() AS database
      `),
      runtime.query(`
        SELECT current_user AS current_user, current_database() AS database
      `),
    ]);
    assert.deepEqual(identities[0].rows, [{
      current_user: OWNER_ROLE,
      database: DATABASE_NAME,
    }]);
    assert.deepEqual(identities[1].rows, [{
      current_user: RUNTIME_ROLE,
      database: DATABASE_NAME,
    }]);

    const catalog = (await owner.query(`
      SELECT
        routine.prosecdef AS security_definer,
        routine.proconfig AS config,
        pg_catalog.has_function_privilege(
          $1,
          routine.oid,
          'EXECUTE'
        ) AS runtime_execute,
        EXISTS (
          SELECT 1
          FROM pg_catalog.aclexplode(
            COALESCE(
              routine.proacl,
              pg_catalog.acldefault('f', routine.proowner)
            )
          ) AS acl
          WHERE acl.grantee = 0
            AND acl.privilege_type = 'EXECUTE'
        ) AS public_execute
      FROM pg_catalog.pg_proc AS routine
      WHERE routine.oid = $2::pg_catalog.regprocedure
    `, [RUNTIME_ROLE, FUNCTION_IDENTITY])).rows;
    assert.deepEqual(catalog, [{
      security_definer: true,
      config: ["search_path=pg_catalog"],
      runtime_execute: true,
      public_execute: false,
    }]);

    await insertFixture(owner, exact);
    assert.deepEqual(await bind(runtime, exact), {
      action: "bound",
      orderId: exact.orderId,
      transferId: exact.transferId,
    });
    assert.deepEqual(await bind(runtime, exact), {
      action: "replay",
      orderId: exact.orderId,
      transferId: exact.transferId,
    });
    const stored = await owner.query(`
      SELECT "stripeTransferId" AS transfer_id
      FROM public."Order"
      WHERE id = $1
    `, [exact.orderId]);
    assert.deepEqual(stored.rows, [{ transfer_id: exact.transferId }]);

    await assert.rejects(
      bind(runtime, exact, { transferId: null }),
      /Blocked-checkout transfer binding input is invalid/,
    );
    await assert.rejects(
      bind(runtime, exact, { transferId: `${exact.transferId}_conflict` }),
      /conflicts with the durable transfer/,
    );

    await insertFixture(owner, late, { refunded: true });
    await assert.rejects(
      bind(runtime, late),
      /arrived after refund authority/,
    );

    return Object.freeze({
      database: DATABASE_NAME,
      ownerRole: OWNER_ROLE,
      runtimeRole: RUNTIME_ROLE,
      directRuntimeLogin: true,
      functionIdentity: FUNCTION_IDENTITY,
      bound: true,
      replayed: true,
      nullRejected: true,
      conflictRejected: true,
      lateRefundRejected: true,
      productionTouched: false,
    });
  } finally {
    await owner.query(
      `DELETE FROM public."Order" WHERE id = ANY($1::text[])`,
      [[exact.orderId, late.orderId]],
    ).catch(() => {});
    await owner.query(
      `DELETE FROM public."StripeWebhookEvent" WHERE id = ANY($1::text[])`,
      [[exact.eventId, late.eventId]],
    ).catch(() => {});
    await owner.query(
      `DELETE FROM public."Listing" WHERE id = ANY($1::text[])`,
      [[exact.listingId, late.listingId]],
    ).catch(() => {});
    await owner.query(
      `DELETE FROM public."SellerProfile" WHERE id = ANY($1::text[])`,
      [[exact.sellerProfileId, late.sellerProfileId]],
    ).catch(() => {});
    await owner.query(
      `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
      [[exact.sellerUserId, late.sellerUserId]],
    ).catch(() => {});
    await runtime.end().catch(() => {});
    await owner.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runBlockedCheckoutTransferBindingPostgresProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Blocked-checkout transfer binding PostgreSQL proof failed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
