import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseName = "grainline_account_deletion_concurrency_proof";
const ownerName = "account_deletion_proof_owner";

export function proofConfig(env = process.env) {
  const value = env.ORDER_ACCOUNT_DELETION_CONCURRENCY_PROOF_DATABASE_URL;
  assert.ok(value, "ORDER_ACCOUNT_DELETION_CONCURRENCY_PROOF_DATABASE_URL is required");
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1", "proof requires numeric loopback");
  assert.equal(url.pathname, `/${databaseName}`, "proof requires its disposable database");
  assert.equal(url.username, ownerName, "proof requires its disposable owner");
  assert.equal(url.search, "", "proof rejects connection-option overrides");
  return { connectionString: value, connectionTimeoutMillis: 5_000 };
}

async function waitBlocked(observer, blockedPid, blockerPid) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await observer.query(
      "SELECT $2::int = ANY(pg_catalog.pg_blocking_pids($1::int)) AS blocked",
      [blockedPid, blockerPid],
    );
    if (result.rows[0]?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("account-deletion proof did not reach its observed Order lock barrier");
}

function fixtureSql() {
  return `
    DO $roles$
    BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grainline_app_runtime') THEN
        CREATE ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'grainline_staff_read_runtime') THEN
        CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT NOBYPASSRLS;
      END IF;
    END
    $roles$;
    ALTER ROLE grainline_app_runtime LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    ALTER ROLE grainline_staff_read_runtime LOGIN NOINHERIT NOBYPASSRLS NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TYPE public."LabelStatus" AS ENUM ('PURCHASED', 'EXPIRED', 'VOIDED');
    CREATE TYPE public."FulfillmentStatus" AS ENUM (
      'PENDING', 'READY_FOR_PICKUP', 'SHIPPED', 'DELIVERED', 'PICKED_UP', 'CANCELED'
    );
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL UNIQUE,
      email varchar(254) NOT NULL UNIQUE,
      name varchar(100),
      role public."Role" NOT NULL DEFAULT 'USER',
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      "shippingName" varchar(100),
      "shippingLine1" varchar(200),
      "shippingLine2" varchar(200),
      "shippingCity" varchar(100),
      "shippingState" varchar(50),
      "shippingPostalCode" varchar(20),
      "shippingPhone" varchar(30)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" varchar(100) NOT NULL,
      city varchar(100), state varchar(50), "shipFromName" varchar(100),
      "shipFromLine1" varchar(200), "shipFromLine2" varchar(200),
      "shipFromCity" varchar(100), "shipFromState" varchar(50),
      "shipFromPostal" varchar(20), tagline varchar(140),
      "bannerImageUrl" varchar(2048), "avatarImageUrl" varchar(2048),
      "workshopImageUrl" varchar(2048), "instagramUrl" varchar(2048),
      "facebookUrl" varchar(2048), "pinterestUrl" varchar(2048),
      "tiktokUrl" varchar(2048), "websiteUrl" varchar(2048)
    );
    CREATE TABLE public."Order" (
      id text PRIMARY KEY,
      "buyerId" text REFERENCES public."User"(id),
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      "fulfillmentStatus" public."FulfillmentStatus" NOT NULL DEFAULT 'PENDING',
      "deliveredAt" timestamp(3) without time zone,
      "pickedUpAt" timestamp(3) without time zone,
      "sellerRefundId" varchar(255), "sellerRefundAmountCents" integer,
      "chargedTotalCents" integer, "itemsSubtotalCents" integer NOT NULL DEFAULT 0,
      "shippingAmountCents" integer NOT NULL DEFAULT 0,
      "giftWrappingPriceCents" integer, "taxAmountCents" integer NOT NULL DEFAULT 0,
      "reviewNote" varchar(10000), "buyerEmail" varchar(254),
      "reviewNeeded" boolean NOT NULL DEFAULT false,
      "labelStatus" public."LabelStatus",
      "labelClawbackStatus" varchar(50),
      "buyerName" varchar(200), "shipToLine1" varchar(200),
      "shipToLine2" varchar(200), "shipToCity" varchar(100),
      "shipToState" varchar(50), "shipToPostalCode" varchar(20),
      "shipToCountry" varchar(2), "quotedToLine1" varchar(200),
      "quotedToLine2" varchar(200), "quotedToCity" varchar(100),
      "quotedToState" varchar(50), "quotedToPostalCode" varchar(20),
      "quotedToCountry" varchar(2), "quotedToName" varchar(200),
      "quotedToPhone" varchar(30), "trackingCarrier" varchar(100),
      "trackingNumber" varchar(100), "sellerNotes" varchar(2000),
      "shippoShipmentId" varchar(255), "shippoRateObjectId" varchar(255),
      "shippoTransactionId" varchar(255), "labelUrl" varchar(2048),
      "labelCarrier" varchar(100), "labelTrackingNumber" varchar(100),
      "giftNote" varchar(500), "buyerDataPurgedAt" timestamp(3) without time zone
    );
    CREATE INDEX "Order_buyerId_idx" ON public."Order"("buyerId");
    CREATE INDEX "Order_sellerProfileId_idx" ON public."Order"("sellerProfileId");
    CREATE TABLE public."OrderShippingRateQuote" (
      id text PRIMARY KEY,
      "orderId" text NOT NULL REFERENCES public."Order"(id) ON DELETE CASCADE
    );
    CREATE INDEX "OrderShippingRateQuote_orderId_idx"
      ON public."OrderShippingRateQuote"("orderId");
    CREATE TABLE public."AdminAuditLog" (
      id text PRIMARY KEY,
      "adminId" text NOT NULL REFERENCES public."User"(id),
      action varchar(100) NOT NULL,
      "targetType" varchar(100) NOT NULL,
      "targetId" varchar(255) NOT NULL,
      metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
      undone boolean NOT NULL DEFAULT false,
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE FUNCTION public.grainline_account_deletion_redact_text_core(
      p_body text,
      p_sensitive_values text[]
    ) RETURNS text
    LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = pg_catalog
    AS $redact$
    DECLARE value text; result text := p_body;
    BEGIN
      IF p_body IS NULL THEN RETURN NULL; END IF;
      FOREACH value IN ARRAY COALESCE(p_sensitive_values, ARRAY[]::text[]) LOOP
        result := pg_catalog.replace(result, value, '[deleted account]');
      END LOOP;
      RETURN result;
    END
    $redact$;
    REVOKE ALL ON FUNCTION public.grainline_account_deletion_redact_text_core(text, text[])
      FROM PUBLIC, grainline_app_runtime;

    INSERT INTO public."User" (id, "clerkId", email, name, role)
    VALUES
      ('buyer-1', 'clerk-buyer-1', 'buyer@example.test', 'Buyer One', 'USER'),
      ('other-1', 'clerk-other-1', 'other@example.test', 'Other One', 'USER'),
      ('staff-1', 'clerk-staff-1', 'staff@example.test', 'Staff One', 'EMPLOYEE');
    INSERT INTO public."Order" (
      id, "buyerId", "fulfillmentStatus", "reviewNote", "buyerEmail", "buyerName"
    ) VALUES
      ('order-1', 'buyer-1', 'CANCELED',
       'Customer Buyer One requested deletion', 'buyer@example.test', 'Buyer One'),
      ('order-other', 'other-1', 'CANCELED',
       'Other retained note', 'other@example.test', 'Other One');
    INSERT INTO public."OrderShippingRateQuote" (id, "orderId")
    VALUES ('quote-1', 'order-1'), ('quote-other', 'order-other');
  `;
}

export async function runProof(config = proofConfig()) {
  const clients = Array.from({ length: 4 }, () => new pg.Client(config));
  const [controller, staff, deletion, observer] = clients;
  try {
    await Promise.all(clients.map((client) => client.connect()));
    for (const client of clients) {
      await client.query(
        "SET statement_timeout = '15s'; SET lock_timeout = '12s'; SET deadlock_timeout = '500ms'",
      );
    }
    const identity = await controller.query(`
      SELECT current_database() AS db,
             current_user AS role,
             host(pg_catalog.inet_server_addr()) AS host,
             current_setting('server_version_num')::int AS version
    `);
    assert.deepEqual(
      {
        db: identity.rows[0].db,
        role: identity.rows[0].role,
        host: identity.rows[0].host,
        version: Math.floor(identity.rows[0].version / 10_000),
      },
      { db: databaseName, role: ownerName, host: "127.0.0.1", version: 16 },
    );
    const existing = await controller.query(`
      SELECT pg_catalog.count(*)::int AS count
        FROM pg_catalog.pg_class AS relation
        JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
       WHERE namespace.nspname = 'public'
    `);
    assert.equal(existing.rows[0].count, 0, "proof refuses a nonempty database");

    await controller.query(fixtureSql());
    const migration = fs.readFileSync(
      path.join(
        root,
        "prisma/migrations/20260905020000_prepare_order_account_deletion_authority/migration.sql",
      ),
      "utf8",
    );
    await controller.query(migration);
    await controller.query(
      fs.readFileSync(
        path.join(
          root,
          "prisma/migrations/20260905090000_prepare_order_staff_mutation_authority/migration.sql",
        ),
        "utf8",
      ),
    );
    await controller.query(`
      GRANT EXECUTE ON FUNCTION public.grainline_order_staff_append_note(text, text, text)
        TO grainline_staff_read_runtime
    `);

    await staff.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
    await staff.query("BEGIN");
    const staffResult = await staff.query(`
      SELECT public.grainline_order_staff_append_note(
        'staff-1',
        'order-1',
        'New staff evidence'
      ) AS status
    `);
    assert.deepEqual(staffResult.rows, [{ status: "updated" }]);
    const staffPid = (await staff.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    const deletionPid = (await deletion.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;

    await deletion.query("BEGIN");
    await deletion.query("SET LOCAL ROLE grainline_app_runtime");
    await deletion.query(
      "SELECT pg_catalog.set_config('app.user_id', 'buyer-1', true)",
    );
    const pendingDeletion = deletion.query(`
      SELECT *
        FROM public.grainline_order_account_deletion_scrub(
          'buyer-1',
          ARRAY[]::text[]
        )
    `);

    await waitBlocked(observer, deletionPid, staffPid);
    await staff.query("COMMIT");
    const deletionResult = await pendingDeletion;
    await deletion.query("COMMIT");

    assert.deepEqual(deletionResult.rows, [{
      review_notes_redacted: "1",
      buyer_orders_scrubbed: "1",
      seller_orders_scrubbed: "0",
      shipping_quotes_deleted: "1",
    }]);
    const final = await controller.query(`
      SELECT id, "reviewNote", "buyerEmail", "buyerName"
        FROM public."Order"
       ORDER BY id
    `);
    assert.equal(final.rows[0].id, "order-1");
    assert.match(
      final.rows[0].reviewNote,
      /^Customer \[deleted account\] requested deletion\n\n\[[^\]]+ UTC\]\nNew staff evidence$/u,
    );
    assert.equal(final.rows[0].buyerEmail, null);
    assert.equal(final.rows[0].buyerName, null);
    assert.deepEqual(final.rows[1], {
        id: "order-other",
        reviewNote: "Other retained note",
        buyerEmail: "other@example.test",
        buyerName: "Other One",
    });
    const audit = await controller.query(`
      SELECT action, "adminId", "targetId"
        FROM public."AdminAuditLog"
    `);
    assert.deepEqual(audit.rows, [{
      action: "APPEND_ORDER_NOTE",
      adminId: "staff-1",
      targetId: "order-1",
    }]);
    return Object.freeze({
      lockObserved: true,
      concurrentStaffNotePreserved: true,
      actorOrderScrubbed: true,
      unrelatedOrderPreserved: true,
      staffAuditPreserved: true,
    });
  } finally {
    await Promise.allSettled([staff.query("ROLLBACK"), deletion.query("ROLLBACK")]);
    await Promise.allSettled(clients.map((client) => client.end()));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    process.stdout.write(`${JSON.stringify(await runProof(), null, 2)}\n`);
  } catch (error) {
    process.stderr.write(
      `Order account-deletion concurrency proof failed closed: ${
        error instanceof Error ? error.message : "unknown error"
      }\n`,
    );
    process.exitCode = 1;
  }
}
