import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { Prisma } from "@prisma/client";
import {
  latestConversionBlockingDisputeLedgerExistsSql,
  latestOpenDisputeLedgerExistsSql,
} from "../src/lib/refundLedgerSql.ts";

async function querySql(database, statement) {
  return database.query(statement.text, statement.values);
}

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
        metadata,
        "createdAt"
      )
      VALUES ($1, $2, 'DISPUTE', $3, $4, $5::jsonb, $6::timestamptz)
    `,
    [
      id,
      orderId,
      disputeId,
      status,
      JSON.stringify({ stripeEventCreated: String(providerSecond) }),
      createdAt,
    ],
  );
}

async function disputeState(database, orderId) {
  const statement = Prisma.sql`
    SELECT
      ${latestOpenDisputeLedgerExistsSql(Prisma.sql`${orderId}`)} AS "hasOpen",
      ${latestConversionBlockingDisputeLedgerExistsSql(Prisma.sql`${orderId}`)} AS "blocksConversion"
  `;
  const result = await querySql(database, statement);
  return result.rows[0];
}

describe("OrderPaymentEvent canonical latest-dispute SQL", () => {
  it("uses only each dispute object's latest signed state", async () => {
    const database = new PGlite();
    try {
      await database.exec(`
        CREATE TABLE "OrderPaymentEvent" (
          id text PRIMARY KEY,
          "orderId" text NOT NULL,
          "eventType" text NOT NULL,
          "stripeObjectId" text,
          status text,
          metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
          "createdAt" timestamptz NOT NULL
        )
      `);

      await insertDispute(database, {
        id: "won-open",
        orderId: "order-won",
        disputeId: "dp-won",
        status: "needs_response",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      await insertDispute(database, {
        id: "won-closed",
        orderId: "order-won",
        disputeId: "dp-won",
        status: "won",
        providerSecond: 200,
        createdAt: "2026-08-23T10:01:00Z",
      });
      assert.deepEqual(await disputeState(database, "order-won"), {
        hasOpen: false,
        blocksConversion: false,
      });

      await insertDispute(database, {
        id: "warning-open",
        orderId: "order-warning",
        disputeId: "dp-warning",
        status: "warning_needs_response",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      await insertDispute(database, {
        id: "warning-closed",
        orderId: "order-warning",
        disputeId: "dp-warning",
        status: "warning_closed",
        providerSecond: 200,
        createdAt: "2026-08-23T10:01:00Z",
      });
      assert.deepEqual(await disputeState(database, "order-warning"), {
        hasOpen: false,
        blocksConversion: false,
      });

      await insertDispute(database, {
        id: "lost-open",
        orderId: "order-lost",
        disputeId: "dp-lost",
        status: "needs_response",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      await insertDispute(database, {
        id: "lost-closed",
        orderId: "order-lost",
        disputeId: "dp-lost",
        status: "lost",
        providerSecond: 200,
        createdAt: "2026-08-23T10:01:00Z",
      });
      assert.deepEqual(await disputeState(database, "order-lost"), {
        hasOpen: false,
        blocksConversion: true,
      });

      await insertDispute(database, {
        id: "reopened-won",
        orderId: "order-reopened",
        disputeId: "dp-reopened",
        status: "won",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      await insertDispute(database, {
        id: "reopened-open",
        orderId: "order-reopened",
        disputeId: "dp-reopened",
        status: "needs_response",
        providerSecond: 200,
        createdAt: "2026-08-23T10:01:00Z",
      });
      assert.deepEqual(await disputeState(database, "order-reopened"), {
        hasOpen: true,
        blocksConversion: true,
      });

      await insertDispute(database, {
        id: "unknown",
        orderId: "order-unknown",
        disputeId: "dp-unknown",
        status: "future_provider_state",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      assert.deepEqual(await disputeState(database, "order-unknown"), {
        hasOpen: true,
        blocksConversion: true,
      });

      await insertDispute(database, {
        id: "missing-id-open",
        orderId: "order-missing-id",
        disputeId: null,
        status: "needs_response",
        providerSecond: 100,
        createdAt: "2026-08-23T10:00:00Z",
      });
      await insertDispute(database, {
        id: "missing-id-won",
        orderId: "order-missing-id",
        disputeId: null,
        status: "won",
        providerSecond: 200,
        createdAt: "2026-08-23T10:01:00Z",
      });
      assert.deepEqual(await disputeState(database, "order-missing-id"), {
        hasOpen: true,
        blocksConversion: true,
      });
    } finally {
      await database.close();
    }
  });
});
