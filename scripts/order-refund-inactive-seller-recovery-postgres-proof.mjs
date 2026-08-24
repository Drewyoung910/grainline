#!/usr/bin/env node

import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import pg from "pg";

const { Client } = pg;
const PROOF_ENV =
  "ORDER_REFUND_INACTIVE_SELLER_RECOVERY_PROOF_DATABASE_URL";
const DATABASE_NAME = "grainline_ci";
const MIGRATION_ROLE = "ci";
const RUNTIME_ROLE = "grainline_app_runtime";
const PREFIX = "order-refund-inactive-seller-pg-proof";

const ids = Object.freeze({
  sellerUser: `${PREFIX}-seller-user`,
  buyerUser: `${PREFIX}-buyer-user`,
  adminUser: `${PREFIX}-admin-user`,
  sellerProfile: `${PREFIX}-seller-profile`,
  listing: `${PREFIX}-listing`,
  order: `${PREFIX}-order`,
  orderItem: `${PREFIX}-order-item`,
});

function safeError(error) {
  return (error instanceof Error ? error.message : String(error))
    .replace(/\bpostgres(?:ql)?:\/\/[^\s"')]+/giu, "[redacted-postgres-url]")
    .replace(
      /\b([a-z][a-z0-9+.-]*:\/\/)[^\s/@:]+:[^\s/@]+@/giu,
      "$1[redacted-credentials]@",
    );
}

export function parseOrderRefundInactiveSellerRecoveryProofConfig(
  env = process.env,
) {
  const databaseUrl = env[PROOF_ENV];
  assert.ok(databaseUrl, `${PROOF_ENV} is required`);
  const parsed = new URL(databaseUrl);
  assert.equal(parsed.protocol, "postgresql:");
  assert.ok(
    ["localhost", "127.0.0.1", "::1"].includes(parsed.hostname),
    "Inactive-seller recovery proof refuses a non-loopback database",
  );
  assert.equal(parsed.pathname, `/${DATABASE_NAME}`);
  assert.equal(decodeURIComponent(parsed.username), MIGRATION_ROLE);
  return Object.freeze({ databaseUrl });
}

let savepointSequence = 0;

async function runtimeQuery(client, sql, params = []) {
  savepointSequence += 1;
  const savepoint = `inactive_seller_runtime_${savepointSequence}`;
  await client.query(`SAVEPOINT ${savepoint}`);
  await client.query(`SET LOCAL ROLE ${RUNTIME_ROLE}`);
  try {
    const result = await client.query(sql, params);
    await client.query("RESET ROLE");
    await client.query(`RELEASE SAVEPOINT ${savepoint}`);
    return result;
  } catch (error) {
    await client.query(`ROLLBACK TO SAVEPOINT ${savepoint}`).catch(() => {});
    await client.query("RESET ROLE").catch(() => {});
    await client.query(`RELEASE SAVEPOINT ${savepoint}`).catch(() => {});
    throw error;
  }
}

async function expectError(label, work, code, pattern) {
  let caught;
  try {
    await work();
  } catch (error) {
    caught = error;
  }
  assert.ok(caught, `${label} unexpectedly succeeded`);
  assert.equal(caught.code, code, `${label} returned the wrong SQLSTATE`);
  assert.match(safeError(caught), pattern, label);
}

async function verifyFunctionCatalog(client) {
  const catalog = await client.query(`
    SELECT
      procedure.proname,
      pg_catalog.oidvectortypes(procedure.proargtypes) AS argument_types,
      procedure.prosecdef AS security_definer,
      procedure.provolatile AS volatility,
      procedure.proparallel AS parallel,
      procedure.proconfig AS config,
      pg_catalog.has_function_privilege(
        $1, procedure.oid, 'EXECUTE'
      ) AS runtime_execute,
      pg_catalog.pg_get_functiondef(procedure.oid) AS definition
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
    WHERE namespace.nspname = 'public'
      AND procedure.proname IN (
        'grainline_seller_refund_record',
        'grainline_case_seller_refund_apply'
      )
    ORDER BY procedure.proname
  `, [RUNTIME_ROLE]);
  assert.equal(catalog.rowCount, 2);
  for (const row of catalog.rows) {
    assert.equal(row.security_definer, true, row.proname);
    assert.equal(row.volatility, "v", row.proname);
    assert.equal(row.parallel, "u", row.proname);
    assert.deepEqual(row.config, ["search_path=pg_catalog"], row.proname);
    assert.equal(row.runtime_execute, true, row.proname);
    assert.match(row.definition, /OrderRefundReconciliation/);
    assert.match(row.definition, /administrator\.role = 'ADMIN'/);
    assert.match(
      row.definition,
      /FOR SHARE OF reconciliation, administrator/,
      row.proname,
    );
  }
  assert.equal(
    catalog.rows.find((row) => row.proname === "grainline_seller_refund_record")
      ?.argument_types,
    "text, text, bigint, text, text, text, integer",
  );
  assert.equal(
    catalog.rows.find((row) => row.proname === "grainline_case_seller_refund_apply")
      ?.argument_types,
    "text, text",
  );
}

async function seedFixtures(client) {
  await client.query(`
    INSERT INTO public."User" (
      id, "clerkId", email, name, role, "createdAt", "updatedAt"
    ) VALUES
      ($1, $2, $3, 'Inactive refund seller', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($4, $5, $6, 'Inactive refund buyer', 'USER', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
      ($7, $8, $9, 'Inactive refund admin', 'ADMIN', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
  `, [
    ids.sellerUser,
    `clerk-${ids.sellerUser}`,
    `${ids.sellerUser}@example.invalid`,
    ids.buyerUser,
    `clerk-${ids.buyerUser}`,
    `${ids.buyerUser}@example.invalid`,
    ids.adminUser,
    `clerk-${ids.adminUser}`,
    `${ids.adminUser}@example.invalid`,
  ]);
  await client.query(`
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "displayNameNormalized",
      "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, 'Inactive refund seller', 'inactive refund seller',
      CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.sellerProfile, ids.sellerUser]);
  await client.query(`
    INSERT INTO public."Listing" (
      id, "sellerId", title, description, "priceCents",
      "listingType", "stockQuantity", status, "createdAt", "updatedAt"
    ) VALUES (
      $1, $2, 'Inactive refund proof listing',
      'Loopback-only inactive refund recovery fixture.', 1000,
      'IN_STOCK', 0, 'SOLD_OUT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `, [ids.listing, ids.sellerProfile]);
  await client.query(`
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "paidAt",
      "stripePaymentIntentId", "stripeTransferId", currency,
      "itemsSubtotalCents", "shippingAmountCents",
      "giftWrappingPriceCents", "taxAmountCents"
    ) VALUES (
      $1, $2, $3, CURRENT_TIMESTAMP,
      $4, $5, 'usd', 1000, 200, 50, 75
    )
  `, [
    ids.order,
    ids.buyerUser,
    ids.sellerProfile,
    `pi_${PREFIX.replaceAll("-", "")}`,
    `tr_${PREFIX.replaceAll("-", "")}`,
  ]);
  await client.query(`
    INSERT INTO public."OrderItem" (
      id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents"
    ) VALUES ($1, $2, $3, $4, 2, 500)
  `, [ids.orderItem, ids.order, ids.listing, ids.sellerProfile]);
}

export async function runOrderRefundInactiveSellerRecoveryProof(
  env = process.env,
) {
  const { databaseUrl } =
    parseOrderRefundInactiveSellerRecoveryProofConfig(env);
  const client = new Client({
    application_name: PREFIX,
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    query_timeout: 30_000,
    statement_timeout: 25_000,
  });
  await client.connect();
  let transactionOpen = false;
  try {
    const identity = await client.query(`
      SELECT current_database() AS database_name, CURRENT_USER AS current_user
    `);
    assert.deepEqual(identity.rows, [{
      database_name: DATABASE_NAME,
      current_user: MIGRATION_ROLE,
    }]);
    await verifyFunctionCatalog(client);
    await client.query("BEGIN");
    transactionOpen = true;
    await seedFixtures(client);

    const claim = (await runtimeQuery(client, `
      SELECT public.grainline_seller_refund_claim($1, $2) AS result
    `, [ids.sellerUser, ids.order])).rows[0].result;
    assert.equal(claim.action, "claimed");

    await client.query(
      'UPDATE public."User" SET banned = true WHERE id = $1',
      [ids.sellerUser],
    );
    await expectError(
      "inactive seller without reconciliation",
      () => runtimeQuery(client, `
        SELECT public.grainline_seller_refund_record(
          $1, $2, $3, 're_inactivesellerproof', 'succeeded',
          'trr_inactivesellerproof', 1200
        )
      `, [ids.sellerUser, claim.claimId, claim.claimGeneration]),
      "42501",
      /lacks exact ADMIN reconciliation/,
    );

    await client.query(
      'UPDATE public."User" SET banned = false WHERE id = $1',
      [ids.sellerUser],
    );
    await runtimeQuery(client, `
      SELECT public.grainline_order_refund_claim_mark_ambiguous(
        $1, $2, 'SELLER_PROVIDER_AMBIGUOUS'
      )
    `, [claim.claimId, claim.claimGeneration]);
    const prepared = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_reconciliation_prepare($1, $2)
        AS result
    `, [ids.adminUser, ids.order])).rows[0].result;
    const reconciled = (await runtimeQuery(client, `
      SELECT public.grainline_order_refund_reconcile(
        $1, $2, $3, 'CONFIRMED_PROVIDER_EFFECT', $4, $5,
        'USABLE_REFUND', $6
      ) AS result
    `, [
      ids.adminUser,
      claim.claimId,
      claim.claimGeneration,
      "Confirmed the exact existing Stripe refund before local recovery.",
      Number(prepared.providerAuthorizedAtSeconds),
      "c".repeat(64),
    ])).rows[0].result;
    assert.equal(reconciled.action, "provider_effect_authorized");

    await client.query(
      'UPDATE public."User" SET banned = true WHERE id = $1',
      [ids.sellerUser],
    );
    const recorded = (await runtimeQuery(client, `
      SELECT public.grainline_seller_refund_record(
        $1, $2, $3, 're_inactivesellerproof', 'succeeded',
        'trr_inactivesellerproof', 1200
      ) AS result
    `, [ids.sellerUser, claim.claimId, claim.claimGeneration])).rows[0].result;
    assert.equal(recorded.action, "recorded");
    assert.equal(recorded.caseAction, "no_case");
    assert.equal(recorded.refundAmountCents, 1325);
    assert.equal(recorded.restoredActiveListingCount, 1);

    const durable = await client.query(`
      SELECT
        orders."sellerRefundId",
        orders."refundClaimId",
        listing."stockQuantity",
        listing.status::text AS "listingStatus",
        payment_event.metadata->>'refundClaimId' AS "eventClaimId",
        payment_event.metadata->>'refundClaimSourceId' AS "eventSourceId"
      FROM public."Order" AS orders
      JOIN public."OrderItem" AS item ON item."orderId" = orders.id
      JOIN public."Listing" AS listing ON listing.id = item."listingId"
      JOIN public."OrderPaymentEvent" AS payment_event
        ON payment_event."orderId" = orders.id
       AND payment_event."stripeObjectId" = 're_inactivesellerproof'
      WHERE orders.id = $1
    `, [ids.order]);
    assert.deepEqual(durable.rows, [{
      sellerRefundId: "re_inactivesellerproof",
      refundClaimId: null,
      stockQuantity: 2,
      listingStatus: "ACTIVE",
      eventClaimId: claim.claimId,
      eventSourceId: ids.sellerUser,
    }]);

    const replay = (await runtimeQuery(client, `
      SELECT public.grainline_seller_refund_record(
        $1, $2, $3, 're_inactivesellerproof', 'succeeded',
        'trr_inactivesellerproof', 1200
      ) AS result
    `, [ids.sellerUser, claim.claimId, claim.claimGeneration])).rows[0].result;
    assert.equal(replay.action, "replay");
    assert.equal(replay.paymentEventId, recorded.paymentEventId);

    await client.query("ROLLBACK");
    transactionOpen = false;
    const residue = await client.query(`
      SELECT pg_catalog.count(*)::integer AS count
        FROM public."User"
       WHERE id = ANY($1::text[])
    `, [[ids.sellerUser, ids.buyerUser, ids.adminUser]]);
    assert.equal(residue.rows[0].count, 0);

    return Object.freeze({
      database: DATABASE_NAME,
      migrationRole: MIGRATION_ROLE,
      runtimeRole: RUNTIME_ROLE,
      exactExistingFunctions: 2,
      inactiveWithoutReconciliationDenied: true,
      exactAdminReconciliationRecovered: true,
      adminAuthorityLockedThroughFinalization: true,
      caseSideEffectBoundaryReached: true,
      exactReplayIdempotent: true,
      residueRows: 0,
      productionTouched: false,
    });
  } finally {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    await client.end().catch(() => {});
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(
      await runOrderRefundInactiveSellerRecoveryProof(),
      null,
      2,
    )}\n`);
  } catch (error) {
    process.stderr.write(
      `Order refund inactive-seller PostgreSQL proof failed: ${safeError(error)}\n`,
    );
    process.exitCode = 1;
  }
}
