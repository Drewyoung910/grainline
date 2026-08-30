import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20260830020000_prepare_order_payment_event_transition_authority/migration.sql",
  "utf8",
);
const stateFunction = migration.match(
  /CREATE FUNCTION public\.grainline_order_payment_open_dispute_state\([\s\S]*?\n\$grainline_order_payment_open_dispute_state\$;/u,
)?.[0];

assert.ok(stateFunction, "open-dispute projection function is missing");

async function insertDispute(database, {
  id,
  orderId,
  disputeId,
  status,
  providerSecond,
  createdAt,
}) {
  await database.query(
    `
      INSERT INTO "OrderPaymentEvent" (
        id,
        "orderId",
        "eventType",
        "stripeObjectId",
        status,
        "stripeEventCreatedSeconds",
        "createdAt"
      )
      VALUES ($1, $2, 'DISPUTE', $3, $4, $5, $6::timestamptz)
    `,
    [id, orderId, disputeId, status, providerSecond, createdAt],
  );
}

async function openDisputeBlocked(database, orderId) {
  const result = await database.query(
    `SELECT public.grainline_order_payment_open_dispute_state($1) AS blocked`,
    [orderId],
  );
  return result.rows[0]?.blocked;
}

describe("OrderPaymentEvent open-dispute projection", () => {
  it("uses only each dispute object's latest provider-ordered state", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE TABLE "OrderPaymentEvent" (
          id text PRIMARY KEY,
          "orderId" text NOT NULL,
          "eventType" text NOT NULL,
          "stripeObjectId" text,
          status text,
          "stripeEventCreatedSeconds" bigint,
          "createdAt" timestamptz NOT NULL
        );
        ${stateFunction}
      `);

      await insertDispute(database, {
        id: "won-open",
        orderId: "order-won",
        disputeId: "du_won",
        status: "needs_response",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      await insertDispute(database, {
        id: "won-closed",
        orderId: "order-won",
        disputeId: "du_won",
        status: "won",
        providerSecond: 200,
        createdAt: "2026-08-23T10:01:00Z",
      });
      assert.equal(await openDisputeBlocked(database, "order-won"), false);

      for (const status of ["lost", "prevented", "warning_closed"]) {
        const orderId = `order-${status}`;
        await insertDispute(database, {
          id: `${status}-open`,
          orderId,
          disputeId: `du_${status}`,
          status: "needs_response",
          providerSecond: 100,
          createdAt: "2026-08-23T10:00:00Z",
        });
        await insertDispute(database, {
          id: `${status}-closed`,
          orderId,
          disputeId: `du_${status}`,
          status,
          providerSecond: 200,
          createdAt: "2026-08-23T10:01:00Z",
        });
        assert.equal(await openDisputeBlocked(database, orderId), false);
      }

      await insertDispute(database, {
        id: "tie-closed",
        orderId: "order-tie",
        disputeId: "du_tie",
        status: "won",
        providerSecond: 500,
        createdAt: "2026-08-23T10:02:00Z",
      });
      await insertDispute(database, {
        id: "tie-open",
        orderId: "order-tie",
        disputeId: "du_tie",
        status: "under_review",
        providerSecond: 500,
        createdAt: "2026-08-23T10:03:00Z",
      });
      assert.equal(await openDisputeBlocked(database, "order-tie"), true);

      await insertDispute(database, {
        id: "reopened-won",
        orderId: "order-reopened",
        disputeId: "du_reopened",
        status: "won",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      await insertDispute(database, {
        id: "reopened-open",
        orderId: "order-reopened",
        disputeId: "du_reopened",
        status: "needs_response",
        providerSecond: 200,
        createdAt: "2026-08-23T10:01:00Z",
      });
      assert.equal(await openDisputeBlocked(database, "order-reopened"), true);

      await insertDispute(database, {
        id: "unknown",
        orderId: "order-unknown",
        disputeId: "du_unknown",
        status: "future_provider_state",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      assert.equal(await openDisputeBlocked(database, "order-unknown"), true);
      assert.equal(await openDisputeBlocked(database, "order-none"), false);
    } finally {
      await database.close();
    }
  });
});
