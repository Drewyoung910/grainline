import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const draft = fs.readFileSync(
  "docs/rls-drafts/order-staff-mutation-authority.sql",
  "utf8",
);

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
    CREATE TYPE public."LabelStatus" AS ENUM ('PURCHASED', 'EXPIRED', 'VOIDED');
    CREATE TABLE public."User" (
      id text PRIMARY KEY, role text NOT NULL, banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "reviewNote" text,
      "labelStatus" public."LabelStatus",
      "labelClawbackStatus" text
    );
    CREATE TABLE public."AdminAuditLog" (
      id text PRIMARY KEY, "adminId" text NOT NULL, action text NOT NULL,
      "targetType" text NOT NULL, "targetId" text NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      undone boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO public."User" (id, role) VALUES
      ('employee-1', 'EMPLOYEE'), ('admin-1', 'ADMIN'), ('user-1', 'USER');
    INSERT INTO public."User" (id, role, banned) VALUES ('banned-admin', 'ADMIN', true);
    INSERT INTO public."Order" (
      id, "reviewNeeded", "reviewNote", "labelStatus", "labelClawbackStatus"
    ) VALUES
      ('order-1', true, NULL, 'PURCHASED', NULL),
      ('order-clawback', true, NULL, 'PURCHASED', 'RETRY_PENDING'),
      ('order-expired', true, NULL, 'EXPIRED', NULL);
    REVOKE ALL ON TABLE public."Order", public."AdminAuditLog"
      FROM PUBLIC, grainline_app_runtime;
  `);
  await db.exec(draft);
  return db;
}

async function operation(db, functionName, args) {
  const placeholders = args.map((_, index) => `$${index + 1}`).join(", ");
  return (await db.query(
    `SELECT public.${functionName}(${placeholders}) AS status`,
    args,
  )).rows[0]?.status;
}

describe("Order staff mutation authority in PostgreSQL", () => {
  it("co-commits review, label and note transitions with exact audits", async () => {
    const db = await database();
    try {
      assert.equal(await operation(db, "grainline_order_staff_mark_reviewed", ["employee-1", "order-1"]), "updated");
      assert.equal(await operation(db, "grainline_order_staff_mark_reviewed", ["employee-1", "order-1"]), "unchanged");
      assert.equal(await operation(db, "grainline_order_staff_record_label_voided", ["admin-1", "order-1"]), "updated");
      assert.equal(await operation(db, "grainline_order_staff_append_note", ["admin-1", "order-1", "Checked with carrier"]), "updated");
      const order = (await db.query(`
        SELECT "reviewNeeded", "labelStatus"::text AS label_status, "reviewNote"
          FROM public."Order" WHERE id = 'order-1'
      `)).rows[0];
      assert.equal(order.reviewNeeded, true);
      assert.equal(order.label_status, "VOIDED");
      assert.match(order.reviewNote, /Staff recorded the purchased shipping label/);
      assert.match(order.reviewNote, /Checked with carrier/);
      assert.deepEqual(
        (await db.query(`SELECT action FROM public."AdminAuditLog" ORDER BY "createdAt", action`)).rows.map((row) => row.action).sort(),
        ["APPEND_ORDER_NOTE", "MARK_ORDER_REVIEWED", "RECORD_LABEL_VOIDED"],
      );
    } finally {
      await db.close();
    }
  });

  it("fails closed for inactive actors, clawbacks, wrong label state and note overflow", async () => {
    const db = await database();
    try {
      await assert.rejects(
        operation(db, "grainline_order_staff_mark_reviewed", ["user-1", "order-1"]),
        /requires active staff/i,
      );
      await assert.rejects(
        operation(db, "grainline_order_staff_mark_reviewed", ["banned-admin", "order-1"]),
        /requires active staff/i,
      );
      assert.equal(await operation(db, "grainline_order_staff_mark_reviewed", ["admin-1", "order-clawback"]), "unchanged");
      assert.equal(await operation(db, "grainline_order_staff_record_label_voided", ["admin-1", "order-clawback"]), "active_clawback");
      assert.equal(await operation(db, "grainline_order_staff_record_label_voided", ["admin-1", "order-expired"]), "not_purchased");
      await assert.rejects(
        operation(db, "grainline_order_staff_append_note", ["admin-1", "order-1", "x".repeat(2001)]),
        /note input is invalid/i,
      );
      await db.exec(`UPDATE public."Order" SET "reviewNote" = repeat('x', 9995) WHERE id = 'order-1'`);
      assert.equal(await operation(db, "grainline_order_staff_append_note", ["admin-1", "order-1", "overflow"]), "too_long");
    } finally {
      await db.close();
    }
  });

  it("allows runtime functions but denies direct Order and audit access", async () => {
    const db = await database();
    try {
      await db.exec("SET ROLE grainline_app_runtime");
      assert.equal(await operation(db, "grainline_order_staff_append_note", ["admin-1", "order-1", "runtime note"]), "updated");
      await assert.rejects(db.query('SELECT * FROM public."Order"'), /permission denied/i);
      await assert.rejects(db.query('SELECT * FROM public."AdminAuditLog"'), /permission denied/i);
    } finally {
      await db.exec("RESET ROLE").catch(() => {});
      await db.close();
    }
  });
});
