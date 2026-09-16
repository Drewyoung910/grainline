import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "docs/rls-drafts/order-provider-claim-exclusion.sql",
  "utf8",
);

async function createPredecessorDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TYPE public."LabelStatus" AS ENUM ('PURCHASED', 'EXPIRED', 'VOIDED');
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "labelStatus" public."LabelStatus",
      "labelClaimStatus" varchar(32),
      "sellerRefundId" varchar(255),
      "refundClaimId" varchar(255)
    );
    GRANT SELECT, INSERT, UPDATE, DELETE
      ON TABLE public."Order" TO grainline_app_runtime;
  `);
  return database;
}

async function posture(database) {
  const result = await database.query(`
    SELECT
      class.relrowsecurity AS rls_enabled,
      class.relforcerowsecurity AS rls_forced,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."Order"', 'SELECT'
      ) AS runtime_select,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."Order"', 'INSERT'
      ) AS runtime_insert,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."Order"', 'UPDATE'
      ) AS runtime_update,
      pg_catalog.has_table_privilege(
        'grainline_app_runtime', 'public."Order"', 'DELETE'
      ) AS runtime_delete
    FROM pg_catalog.pg_class AS class
    WHERE class.oid = 'public."Order"'::pg_catalog.regclass
  `);
  return result.rows;
}

describe("Order provider-claim exclusion in PostgreSQL", () => {
  it("rejects label-first and refund-first overlaps without changing security posture", async () => {
    const database = await createPredecessorDatabase();
    try {
      const before = await posture(database);
      await database.exec(migration);
      assert.deepEqual(await posture(database), before);

      await database.exec(`
        INSERT INTO public."Order" (id, "labelClaimStatus")
        VALUES ('label-first', 'PROVIDER_PENDING')
      `);
      await assert.rejects(
        database.exec(`
          UPDATE public."Order"
             SET "sellerRefundId" = 'pending', "refundClaimId" = 'refund-1'
           WHERE id = 'label-first'
        `),
        /Order_provider_claim_mutual_exclusion_check/i,
      );

      await database.exec(`
        INSERT INTO public."Order" (id, "sellerRefundId", "refundClaimId")
        VALUES ('refund-first', 'pending', 'refund-2')
      `);
      await assert.rejects(
        database.exec(`
          UPDATE public."Order"
             SET "labelClaimStatus" = 'PROVIDER_PENDING'
           WHERE id = 'refund-first'
        `),
        /Order_provider_claim_mutual_exclusion_check/i,
      );

      await database.exec(`
        INSERT INTO public."Order" (id, "labelStatus")
        VALUES ('purchased-first', 'PURCHASED')
      `);
      await assert.rejects(
        database.exec(`
          UPDATE public."Order"
             SET "sellerRefundId" = 're_123'
           WHERE id = 'purchased-first'
        `),
        /Order_provider_claim_mutual_exclusion_check/i,
      );
    } finally {
      await database.close();
    }
  });

  it("allows terminal label state after voiding while preserving ordinary states", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(migration);
      await database.exec(`
        INSERT INTO public."Order" (
          id, "labelStatus", "labelClaimStatus", "sellerRefundId", "refundClaimId"
        ) VALUES
          ('voided-refund', 'VOIDED', 'FINALIZED', 're_voided', 'refund-voided'),
          ('inactive-label', NULL, 'FINALIZED', NULL, NULL),
          ('plain-order', NULL, NULL, NULL, NULL)
      `);
      const rows = await database.query(`
        SELECT id FROM public."Order" ORDER BY id
      `);
      assert.deepEqual(rows.rows, [
        { id: "inactive-label" },
        { id: "plain-order" },
        { id: "voided-refund" },
      ]);
    } finally {
      await database.close();
    }
  });

  it("fails closed and rolls back the catalog change when legacy overlap exists", async () => {
    const database = await createPredecessorDatabase();
    try {
      await database.exec(`
        INSERT INTO public."Order" (
          id, "labelClaimStatus", "sellerRefundId", "refundClaimId"
        ) VALUES ('legacy-overlap', 'PROVIDER_AMBIGUOUS', 'pending', 'refund-legacy')
      `);
      await assert.rejects(
        database.exec(migration),
        /found overlapping label\/refund state/i,
      );
      await database.exec("ROLLBACK");
      const constraints = await database.query(`
        SELECT pg_catalog.count(*)::integer AS count
        FROM pg_catalog.pg_constraint AS constraint_metadata
        WHERE constraint_metadata.conrelid = 'public."Order"'::pg_catalog.regclass
          AND constraint_metadata.conname =
            'Order_provider_claim_mutual_exclusion_check'
      `);
      assert.deepEqual(constraints.rows, [{ count: 0 }]);
    } finally {
      await database.close();
    }
  });
});
