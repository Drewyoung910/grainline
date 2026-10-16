import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { executeOrderRefund648Inventory } from "../../../scripts/order-refund-648-production-inventory.mjs";

const PREDECESSOR =
  "20261013190000_move_reconciliation_seller_private_sql_callers";
const REPAIR = "20261015020000_repair_immutable_order_refund_recording";

function functionStatement(sql, name) {
  const start = sql.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  const delimiter = `$${name}$;`;
  const end = sql.indexOf(delimiter, start);
  assert.ok(start >= 0 && end > start, `missing ${name} function statement`);
  return sql.slice(start, end + delimiter.length);
}

async function asRuntime(database, sql, params = []) {
  await database.query("SET SESSION AUTHORIZATION grainline_app_runtime");
  try {
    return await database.query(sql, params);
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

async function seedRefundFixture(database, seller, { suffix = "predecessor" } = {}) {
  const now = new Date();
  const safeSuffix =
    suffix.replace(/[^a-z0-9_-]/giu, "_").slice(0, 40) || "default";
  const providerSuffix = safeSuffix.replace(/[^a-z0-9]/giu, "") || "default";
  const buyerId = `full_chain_refund_buyer_${safeSuffix}`;
  const listingId = `full_chain_refund_listing_${safeSuffix}`;
  const orderId = `full_chain_refund_order_${safeSuffix}`;
  const itemId = `full_chain_refund_item_${safeSuffix}`;
  const refundId = `re_fullchain648${providerSuffix}`;
  const reversalId = `trr_fullchain648${providerSuffix}`;
  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Full Chain Buyer', $4, $4, $4, '2026-01-01', $4)`,
    [
      buyerId,
      `user_full_chain_refund_buyer_${safeSuffix}`,
      `refund-buyer-${safeSuffix}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "shipsWithinDays", category, tags,
       "packagedWeightGrams", "packagedLengthCm", "packagedWidthCm",
       "packagedHeightCm", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full-chain refund fixture', 'Disposable CI fixture',
       500, 'usd', 'SOLD_OUT', 'IN_STOCK', 0, 2, 'KITCHEN', ARRAY['fixture'],
       1000, 30, 20, 10, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  // The production schema checks the durable Order/OrderItem seller key with
  // deferred constraint triggers. Seed both halves in one transaction, just as
  // the checkout authorities do, so the fixture exercises the current schema.
  await database.query("BEGIN");
  try {
    await database.query(
      `INSERT INTO public."Order"
        (id, "buyerId", "sellerProfileId", "createdAt", "paidAt",
         "stripeSessionId", currency, "chargedTotalCents", "itemsSubtotalCents",
         "shippingAmountCents", "taxAmountCents", "giftWrappingPriceCents",
         "stripePaymentIntentId", "stripeChargeId", "stripeTransferId",
         "fulfillmentMethod", "fulfillmentStatus")
       VALUES ($1, $2, $3, $4, $4, $5, 'usd', 1325, 1000,
         200, 75, 50, $6, $7, $8,
         'SHIPPING', 'PENDING')`,
      [
        orderId,
        buyerId,
        seller.sellerProfileId,
        now,
        `cs_fullchain648${providerSuffix}`,
        `pi_fullchain648${providerSuffix}`,
        `ch_fullchain648${providerSuffix}`,
        `tr_fullchain648${providerSuffix}`,
      ],
    );
    await database.query(
      `INSERT INTO public."OrderItem"
        (id, "orderId", "listingId", "sellerProfileId", quantity, "priceCents",
         "createdAt")
       VALUES ($1, $2, $3, $4, 2, 500, $5)`,
      [itemId, orderId, listingId, seller.sellerProfileId, now],
    );
    await database.query("COMMIT");
  } catch (error) {
    try {
      await database.query("ROLLBACK");
    } catch {}
    throw error;
  }
  return { buyerId, listingId, orderId, refundId, reversalId };
}

async function claimSellerRefund(database, seller, fixture) {
  const claim = (await asRuntime(
    database,
    `SELECT public.grainline_seller_refund_claim($1, $2) AS claim`,
    [seller.userId, fixture.orderId],
  )).rows[0].claim;
  assert.equal(claim.action, "claimed");
  assert.equal(claim.refundAmountCents, 1325);
  return claim;
}

async function proveInstalledRepair(database, seller, fixture, claim) {
  const recorded = (await asRuntime(
    database,
    `SELECT public.grainline_seller_refund_record(
      $1, $2, $3::bigint, $4, 'succeeded', $5, 1200
    ) AS result`,
    [
      seller.userId,
      claim.claimId,
      String(claim.claimGeneration),
      fixture.refundId,
      fixture.reversalId,
    ],
  )).rows[0].result;
  assert.equal(recorded.action, "recorded");
  assert.equal(recorded.refundAmountCents, 1325);
  assert.equal(recorded.restoredActiveListingCount, 1);

  const replay = (await asRuntime(
    database,
    `SELECT public.grainline_seller_refund_record(
      $1, $2, $3::bigint, $4, 'succeeded', $5, 1200
    ) AS result`,
    [
      seller.userId,
      claim.claimId,
      String(claim.claimGeneration),
      fixture.refundId,
      fixture.reversalId,
    ],
  )).rows[0].result;
  assert.equal(replay.action, "replay");
  assert.equal(replay.paymentEventId, recorded.paymentEventId);

  const after = (await database.query(
    `SELECT payment_event.metadata,
            listing."stockQuantity" AS stock_quantity,
            listing.status::text AS listing_status
       FROM public."OrderPaymentEvent" AS payment_event
       JOIN public."Order" AS orders ON orders.id = payment_event."orderId"
       JOIN public."OrderItem" AS item ON item."orderId" = orders.id
       JOIN public."Listing" AS listing ON listing.id = item."listingId"
      WHERE payment_event."stripeEventId" = $1`,
    [`local:seller_refund_recorded:${fixture.refundId}`],
  )).rows;
  assert.equal(after.length, 1);
  assert.equal(after[0].metadata.restoredActiveListingCount, 1);
  assert.equal(after[0].stock_quantity, 2);
  assert.equal(after[0].listing_status, "ACTIVE");
}

export async function proveInstalledImmutableRefundRepair({
  database,
  seller,
  suffix = "installed",
}) {
  const fixture = await seedRefundFixture(database, seller, { suffix });
  const claim = await claimSellerRefund(database, seller, fixture);
  await proveInstalledRepair(database, seller, fixture, claim);
}

export async function proveImmutableRefundRepair({
  database,
  repositoryRoot,
  seller,
}) {
  const migrationRoot = path.join(repositoryRoot, "prisma", "migrations");
  const predecessorSql = fs.readFileSync(
    path.join(migrationRoot, PREDECESSOR, "migration.sql"),
    "utf8",
  );
  const repairSql = fs.readFileSync(
    path.join(migrationRoot, REPAIR, "migration.sql"),
    "utf8",
  );

  for (const name of [
    "grainline_blocked_checkout_refund_record_core",
    "grainline_seller_refund_record",
  ]) {
    await database.query(functionStatement(predecessorSql, name));
  }

  const fixture = await seedRefundFixture(database, seller);
  const claim = await claimSellerRefund(database, seller, fixture);

  await assert.rejects(
    asRuntime(
      database,
      `SELECT public.grainline_seller_refund_record(
        $1, $2, $3::bigint, $4, 'succeeded', $5, 1200
      ) AS result`,
      [
        seller.userId,
        claim.claimId,
        String(claim.claimGeneration),
        fixture.refundId,
        fixture.reversalId,
      ],
    ),
    (error) =>
      error?.code === "23514" &&
      /Order payment evidence is immutable/u.test(error.message),
  );
  const before = (await database.query(
    `SELECT
       (SELECT count(*)::integer FROM public."OrderPaymentEvent"
         WHERE "stripeEventId" = $2)
         AS event_count,
       (SELECT "stockQuantity" FROM public."Listing" WHERE id = $1)
         AS stock_quantity`,
    [fixture.listingId, `local:seller_refund_recorded:${fixture.refundId}`],
  )).rows[0];
  assert.deepEqual(before, { event_count: 0, stock_quantity: 0 });

  await database.query(repairSql);
  await proveInstalledRepair(database, seller, fixture, claim);
}

export async function proveOrderRefund648Inventory({
  database,
  repositoryRoot,
}) {
  const counts = async () => (await database.query(`
    SELECT
      (SELECT pg_catalog.count(*)::integer FROM public."Order") AS orders,
      (SELECT pg_catalog.count(*)::integer
         FROM public."OrderPaymentEvent") AS payment_events,
      (SELECT pg_catalog.count(*)::integer
         FROM public."StripeWebhookEvent") AS webhook_events
  `)).rows[0];
  const before = await counts();
  const evidence = await executeOrderRefund648Inventory(database, repositoryRoot);
  assert.ok(Array.isArray(evidence.claimSummary));
  assert.ok(Array.isArray(evidence.lostClaimSummary));
  assert.deepEqual(await counts(), before);
}
