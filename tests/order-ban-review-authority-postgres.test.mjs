import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const draft = fs.readFileSync(
  "docs/rls-drafts/order-ban-review-authority.sql",
  "utf8",
);
const marker =
  "Seller account was banned after payment. Staff must review fulfillment and refund options before further action.";

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED', 'PICKED_UP'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      role text NOT NULL,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text,
      "sellerProfileId" text,
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL,
      "sellerRefundId" text,
      "paymentRefundBlocked" boolean NOT NULL DEFAULT false,
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" text
    );
    INSERT INTO public."User" (id, role, banned) VALUES
      ('admin-1', 'ADMIN', false),
      ('employee-1', 'EMPLOYEE', false),
      ('banned-seller', 'USER', true),
      ('other-banned-seller', 'USER', true),
      ('ordinary-user', 'USER', false),
      ('unbanned-seller', 'USER', false);
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-1', 'banned-seller'),
      ('seller-2', 'other-banned-seller'),
      ('seller-3', 'unbanned-seller');
    INSERT INTO public."Order" (
      id, "buyerId", "sellerProfileId", "fulfillmentStatus",
      "sellerRefundId", "paymentRefundBlocked", "reviewNeeded", "reviewNote"
    ) VALUES
      ('open-empty', 'buyer-1', 'seller-1', 'PENDING', NULL, false, false, NULL),
      ('open-note', 'buyer-2', 'seller-1', 'SHIPPED', NULL, false, false, 'Existing staff note'),
      ('open-marker', 'buyer-3', 'seller-1', 'READY_FOR_PICKUP', NULL, false, true, '${marker}'),
      ('open-long', 'buyer-4', 'seller-1', 'PENDING', NULL, false, false, repeat('x', 9999)),
      ('closed', 'buyer-5', 'seller-1', 'DELIVERED', NULL, false, false, NULL),
      ('refunded', 'buyer-6', 'seller-1', 'PENDING', 're_1', false, false, NULL),
      ('refund-blocked', 'buyer-7', 'seller-1', 'PENDING', NULL, true, false, NULL),
      ('other-order', 'buyer-8', 'seller-2', 'PENDING', NULL, false, false, NULL);
    REVOKE ALL ON TABLE public."User", public."SellerProfile", public."Order"
      FROM PUBLIC, grainline_app_runtime;
  `);
  await db.exec(draft);
  await db.exec(`
    GRANT EXECUTE ON FUNCTION
      public.grainline_order_staff_capability_mint(text, text, text, jsonb)
      TO grainline_staff_read_runtime;
  `);
  return db;
}

async function withSession(db, role, callback) {
  await db.exec(`SET SESSION AUTHORIZATION ${role}`);
  try {
    return await callback();
  } finally {
    await db.exec("RESET SESSION AUTHORIZATION").catch(() => {});
  }
}

async function withRole(db, role, callback) {
  await db.exec(`SET ROLE ${role}`);
  try {
    return await callback();
  } finally {
    await db.exec("RESET ROLE").catch(() => {});
  }
}

async function mint(
  db,
  operation,
  payload,
  actor = "admin-1",
  target = "banned-seller",
) {
  const payloadJson = payload === null ? null : JSON.stringify(payload);
  return (await db.query(`
    INSERT INTO public."OrderStaffCapability" (
      "actorUserId", "targetUserId", operation, "payloadHash", "expiresAt"
    ) VALUES (
      $1,
      $2,
      $3,
      CASE WHEN $4::jsonb IS NULL THEN NULL ELSE pg_catalog.encode(
        pg_catalog.sha256(pg_catalog.convert_to(($4::jsonb)::text, 'UTF8')),
        'hex'
      ) END,
      pg_catalog.clock_timestamp() + INTERVAL '5 minutes'
    )
    RETURNING id
  `, [actor, target, operation, payloadJson])).rows[0]?.id;
}

async function consumeFlag(db, capability, target = "banned-seller") {
  return withRole(db, "grainline_app_runtime", async () => (
    await db.query(
      "SELECT * FROM public.grainline_order_flag_banned_seller_open_orders($1, $2)",
      [capability, target],
    )
  ).rows);
}

async function flag(db, actor = "admin-1", target = "banned-seller") {
  const capability = await mint(db, "BAN_REVIEW_FLAG", null, actor, target);
  return consumeFlag(db, capability, target);
}

async function consumeRestore(db, capability, snapshots, target = "banned-seller") {
  return withRole(db, "grainline_app_runtime", async () => (
    await db.query(
      "SELECT public.grainline_order_restore_banned_seller_reviews($1, $2, $3::jsonb) AS restored_count",
      [capability, target, JSON.stringify(snapshots)],
    )
  ).rows[0]?.restored_count);
}

async function restore(db, snapshots, actor = "admin-1", target = "banned-seller") {
  const capability = await mint(
    db,
    "BAN_REVIEW_RESTORE",
    snapshots,
    actor,
    target,
  );
  return consumeRestore(db, capability, snapshots, target);
}

function restorePayload(rows) {
  return rows.map((row) => ({
    id: row.order_id,
    previousReviewNeeded: row.previous_review_needed,
    previousReviewNoteHash: row.previous_review_note_hash,
    previousReviewNoteLength: row.previous_review_note_length,
    addedReviewNote: row.added_review_note,
  }));
}

describe("Order ban review authority in PostgreSQL", () => {
  it("flags only exact open seller Orders without truncating staff notes", async () => {
    const db = await database();
    try {
      const rows = await flag(db);
      assert.deepEqual(rows.map((row) => row.order_id), [
        "open-empty",
        "open-long",
        "open-marker",
        "open-note",
      ]);
      assert.equal(rows.find((row) => row.order_id === "open-empty").added_review_note, true);
      assert.equal(rows.find((row) => row.order_id === "open-note").previous_review_note_length, 19);
      assert.match(
        rows.find((row) => row.order_id === "open-note").previous_review_note_hash,
        /^[a-f0-9]{64}$/,
      );
      assert.equal(rows.find((row) => row.order_id === "open-marker").added_review_note, false);
      assert.equal(rows.find((row) => row.order_id === "open-long").added_review_note, false);

      const orders = (await db.query(`
        SELECT id, "reviewNeeded", "reviewNote"
          FROM public."Order" ORDER BY id
      `)).rows;
      assert.equal(orders.find((row) => row.id === "open-empty").reviewNote, marker);
      assert.equal(
        orders.find((row) => row.id === "open-note").reviewNote,
        `Existing staff note\n\n${marker}`,
      );
      assert.equal(orders.find((row) => row.id === "open-long").reviewNote.length, 9999);
      assert.equal(orders.find((row) => row.id === "closed").reviewNeeded, false);
      assert.equal(orders.find((row) => row.id === "refunded").reviewNeeded, false);
      assert.equal(orders.find((row) => row.id === "refund-blocked").reviewNeeded, false);
      assert.equal(orders.find((row) => row.id === "other-order").reviewNeeded, false);
    } finally {
      await db.close();
    }
  });

  it("restores only the exact marker suffix and preserves later staff edits", async () => {
    const db = await database();
    try {
      const rows = await flag(db);
      const snapshots = restorePayload(rows);
      await db.exec(`
        UPDATE public."Order"
           SET "reviewNote" = "reviewNote" || E'\\nLater staff edit'
         WHERE id = 'open-note'
      `);
      assert.equal(await restore(db, snapshots), 1);
      const restored = (await db.query(`
        SELECT id, "reviewNeeded", "reviewNote"
          FROM public."Order"
         WHERE id IN ('open-empty', 'open-note', 'open-marker', 'open-long')
         ORDER BY id
      `)).rows;
      assert.deepEqual(restored.find((row) => row.id === "open-empty"), {
        id: "open-empty",
        reviewNeeded: false,
        reviewNote: null,
      });
      assert.match(restored.find((row) => row.id === "open-note").reviewNote, /Later staff edit$/);
      assert.equal(restored.find((row) => row.id === "open-marker").reviewNote, marker);
      assert.equal(restored.find((row) => row.id === "open-long").reviewNote.length, 9999);
    } finally {
      await db.close();
    }
  });

  it("rejects forged actors, targets, snapshots and direct runtime reads", async () => {
    const db = await database();
    try {
      await assert.rejects(flag(db, "ordinary-user"), /requires an active administrator/i);
      await assert.rejects(flag(db, "employee-1"), /requires an active administrator/i);
      await assert.rejects(flag(db, "admin-1", "unbanned-seller"), /not an active banned user/i);
      await assert.rejects(
        restore(db, [{
          id: "other-order",
          previousReviewNeeded: false,
          previousReviewNoteHash: null,
          previousReviewNoteLength: 0,
          addedReviewNote: true,
        }]),
        /outside the target seller/i,
      );
      await assert.rejects(
        restore(db, [
          {
            id: "open-empty",
            previousReviewNeeded: false,
            previousReviewNoteHash: null,
            previousReviewNoteLength: 0,
          },
          {
            id: "open-empty",
            previousReviewNeeded: false,
            previousReviewNoteHash: null,
            previousReviewNoteLength: 0,
          },
        ]),
        /duplicate Orders/i,
      );

      assert.equal((await flag(db, "admin-1")).length, 4);
      await withRole(db, "grainline_app_runtime", async () => {
        await assert.rejects(db.query('SELECT * FROM public."Order"'), /permission denied/i);
        await assert.rejects(
          db.query('SELECT * FROM public."OrderStaffCapability"'),
          /permission denied/i,
        );
        await assert.rejects(
          db.query(
            "SELECT public.grainline_order_staff_capability_mint('admin-1', 'banned-seller', 'BAN_REVIEW_FLAG', NULL)",
          ),
          /permission denied/i,
        );
      });
    } finally {
      await db.close();
    }
  });

  it("makes capabilities one-use, payload-bound, expiring and rollback-safe", async () => {
    const db = await database();
    try {
      const flagCapability = await mint(db, "BAN_REVIEW_FLAG", null);
      await db.exec("BEGIN");
      const firstRows = await consumeFlag(db, flagCapability);
      assert.equal(firstRows.length, 4);
      await db.exec("ROLLBACK");
      assert.equal((await consumeFlag(db, flagCapability)).length, 4);
      await assert.rejects(
        consumeFlag(db, flagCapability),
        /capability is invalid or expired/i,
      );

      const snapshots = [];
      const restoreCapability = await mint(
        db,
        "BAN_REVIEW_RESTORE",
        snapshots,
      );
      const substituted = [{
        id: "open-empty",
        previousReviewNeeded: false,
        previousReviewNoteHash: null,
        previousReviewNoteLength: 0,
        addedReviewNote: true,
      }];
      await assert.rejects(
        consumeRestore(db, restoreCapability, substituted),
        /capability is invalid or expired/i,
      );
      assert.equal(
        await consumeRestore(db, restoreCapability, snapshots),
        0,
      );

      const expiredCapability = await mint(db, "BAN_REVIEW_FLAG", null);
      await db.query(`
        UPDATE public."OrderStaffCapability"
           SET "expiresAt" = pg_catalog.clock_timestamp() - INTERVAL '1 second'
         WHERE id = $1
      `, [expiredCapability]);
      await assert.rejects(
        consumeFlag(db, expiredCapability),
        /capability is invalid or expired/i,
      );

    } finally {
      await db.close();
    }
  });

  it("mints only through a directly authenticated isolated staff session", async () => {
    const db = await database();
    try {
      await withSession(db, "grainline_staff_read_runtime", async () => {
        const capability = (await db.query(
          "SELECT public.grainline_order_staff_capability_mint('admin-1', 'banned-seller', 'BAN_REVIEW_FLAG', NULL) AS id",
        )).rows[0]?.id;
        assert.match(capability, /^[a-f0-9-]{36}$/);
        await assert.rejects(
          db.query('SELECT * FROM public."OrderStaffCapability"'),
          /permission denied/i,
        );
        await assert.rejects(
          db.query(
            "SELECT public.grainline_order_staff_capability_mint('ordinary-user', 'banned-seller', 'BAN_REVIEW_FLAG', NULL)",
          ),
          /requires an active administrator/i,
        );
      });
    } finally {
      await db.close();
    }
  });

  it("retains the in-function session fence after an accidental runtime grant", async () => {
    const db = await database();
    try {
      await db.exec(`GRANT EXECUTE ON FUNCTION
        public.grainline_order_staff_capability_mint(text, text, text, jsonb)
        TO grainline_app_runtime`);
      await withSession(db, "grainline_app_runtime", async () => {
        await assert.rejects(
          db.query(
            "SELECT public.grainline_order_staff_capability_mint('admin-1', 'banned-seller', 'BAN_REVIEW_FLAG', NULL)",
          ),
          /requires the isolated staff session/i,
        );
      });
    } finally {
      await db.close();
    }
  });
});
