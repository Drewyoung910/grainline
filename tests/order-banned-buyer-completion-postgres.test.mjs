import assert from "node:assert/strict";
import fs from "node:fs";
import { it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { paidCheckoutFixtureSql, provider } from "./helpers/order-paid-checkout-fixture.mjs";

const originalMigration = fs.readFileSync(
  "prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql",
  "utf8",
);
const correctionMigration = fs.readFileSync(
  "prisma/migrations/20260905180000_correct_order_banned_buyer_completion/migration.sql",
  "utf8",
);
const paidCheckoutMigration = fs.readFileSync(
  "prisma/migrations/20260905130000_prepare_order_paid_checkout_authority/migration.sql",
  "utf8",
);

function completionDefinition(sql) {
  const start = sql.indexOf("CREATE FUNCTION public.grainline_checkout_reservation_complete(");
  const replacementStart = sql.indexOf("CREATE OR REPLACE FUNCTION public.grainline_checkout_reservation_complete(");
  const first = start >= 0 ? start : replacementStart;
  assert.ok(first >= 0);
  const endMarker = "$grainline_checkout_reservation_complete$;";
  const end = sql.indexOf(endMarker, first);
  assert.ok(end > first);
  return sql.slice(first, end + endMarker.length).replace(/^CREATE FUNCTION/u, "CREATE OR REPLACE FUNCTION");
}

it("keeps a banned buyer's paid blocked Order durable so the webhook can refund", async () => {
  const db = new PGlite();
  try {
    await db.exec(paidCheckoutFixtureSql());
    await db.exec(`
      ALTER TABLE public."CheckoutStockReservation"
        ADD COLUMN "repairClaimedAt" timestamp(3),
        ADD COLUMN "repairClaimKind" text,
        ADD COLUMN "lastRepairError" text,
        ADD COLUMN "updatedAt" timestamp(3);
    `);
    await db.exec(paidCheckoutMigration);
    await db.exec(`DROP FUNCTION public.grainline_checkout_reservation_complete(text,bigint,text,text)`);
    await db.exec(completionDefinition(originalMigration));
    await db.exec(`
      REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_complete(
        text,bigint,text,text
      ) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_complete(
        text,bigint,text,text
      ) TO grainline_app_runtime;
    `);
    const paidAt = (await db.query(`SELECT (CURRENT_TIMESTAMP - interval '1 minute')::timestamp AS paid_at`)).rows[0].paid_at;
    const create = () => db.query(`
      SELECT * FROM public.grainline_stripe_checkout_order_create(
        'evt_paid_order', 1, 'reservation-1', 'cs_test_proof',
        $1::timestamp, $2::jsonb
      )
    `, [paidAt, JSON.stringify(provider())]);

    await db.exec("BEGIN");
    try {
      await db.exec(`UPDATE public."User" SET banned = true WHERE id = 'buyer-1'`);
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      await assert.rejects(create(), /Checkout completion is missing its durable order/u);
    } finally {
      await db.exec("ROLLBACK");
    }
    assert.equal((await db.query(`SELECT count(*)::integer AS n FROM public."Order"`)).rows[0].n, 0);

    const owner = (await db.query("SELECT current_user AS role_name")).rows[0].role_name;
    assert.match(owner, /^[a-z_][a-z0-9_]*$/u);
    await db.exec(correctionMigration.replaceAll("neondb_owner", owner));
    await db.exec("BEGIN");
    try {
      await db.exec(`UPDATE public."User" SET banned = true WHERE id = 'buyer-1'`);
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      const result = (await create()).rows[0];
      assert.equal(result.outcome, "created");
      assert.match(result.invalid_reason, /Buyer account was suspended/u);
      await db.exec("RESET ROLE");
      const order = (await db.query(`
        SELECT "buyerId" AS buyer_id, "buyerEmail" AS buyer_email,
               "buyerDataPurgedAt" IS NOT NULL AS purged
          FROM public."Order" WHERE id = $1
      `, [result.order_id])).rows[0];
      assert.deepEqual(order, { buyer_id: null, buyer_email: null, purged: true });
      assert.equal((await db.query(`
        SELECT status FROM public."CheckoutStockReservation" WHERE id = 'reservation-1'
      `)).rows[0].status, "COMPLETED");
      await db.query(`UPDATE public."Order" SET "buyerEmail" = 'retained@example.test' WHERE id = $1`, [result.order_id]);
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      await assert.rejects(
        db.query(`SELECT public.grainline_checkout_reservation_complete(
          'evt_paid_order', 1, 'reservation-1', 'cs_test_proof'
        )`),
        /Checkout completion is missing its durable order/u,
      );
    } finally {
      await db.exec("ROLLBACK");
    }

    for (const [accountChange, reason] of [
      [`UPDATE public."User" SET "deletedAt" = CURRENT_TIMESTAMP WHERE id = 'buyer-1'`, /Buyer account was deleted/u],
      [`DELETE FROM public."User" WHERE id = 'buyer-1'`, /Buyer account could not be verified/u],
    ]) {
      await db.exec("BEGIN");
      try {
        await db.exec(accountChange);
        await db.exec("SET LOCAL ROLE grainline_app_runtime");
        const result = (await create()).rows[0];
        assert.equal(result.outcome, "created");
        assert.match(result.invalid_reason, reason);
        await db.exec("RESET ROLE");
        const order = (await db.query(`
          SELECT "buyerId" AS buyer_id, "buyerDataPurgedAt" IS NOT NULL AS purged
            FROM public."Order" WHERE id = $1
        `, [result.order_id])).rows[0];
        assert.deepEqual(order, { buyer_id: null, purged: true });
      } finally {
        await db.exec("ROLLBACK");
      }
    }

    await db.exec("BEGIN");
    try {
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      const result = (await create()).rows[0];
      await db.exec("RESET ROLE");
      await db.query(`
        UPDATE public."Order" SET "buyerId" = NULL,
          "buyerDataPurgedAt" = CURRENT_TIMESTAMP WHERE id = $1
      `, [result.order_id]);
      await db.exec("SET LOCAL ROLE grainline_app_runtime");
      await assert.rejects(
        db.query(`SELECT public.grainline_checkout_reservation_complete(
          'evt_paid_order', 1, 'reservation-1', 'cs_test_proof'
        )`),
        /Checkout completion is missing its durable order/u,
      );
    } finally {
      await db.exec("ROLLBACK");
    }
  } finally {
    await db.close();
  }
});
