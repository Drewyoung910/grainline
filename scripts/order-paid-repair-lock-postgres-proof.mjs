import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";
export { proofServerHostAccepted } from "./disposable-postgres-proof-host.mjs";
import {
  paidCheckoutFixtureSql,
  provider,
  sourceSnapshot,
} from "../tests/helpers/order-paid-checkout-fixture.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const databaseName = "grainline_paid_lock_proof";
export function proofConfig(env = process.env) {
  const value = env.ORDER_PAID_REPAIR_PROOF_DATABASE_URL;
  assert.ok(value, "ORDER_PAID_REPAIR_PROOF_DATABASE_URL is required");
  const url = new URL(value);
  assert.equal(url.protocol, "postgresql:");
  assert.equal(url.hostname, "127.0.0.1", "proof requires numeric loopback");
  assert.equal(url.pathname, `/${databaseName}`, "proof requires its disposable database");
  assert.equal(url.username, "paid_lock_owner", "proof requires its disposable owner");
  assert.equal(url.search, "", "proof rejects connection-option overrides");
  return { connectionString: value, connectionTimeoutMillis: 5_000 };
}

function actualFunction(sql, name) {
  const start = sql.indexOf(`CREATE FUNCTION public.${name}(`);
  const tag = `$${name}$;`;
  const end = sql.indexOf(tag, start);
  assert.ok(start >= 0 && end > start, `missing actual function ${name}`);
  return sql.slice(start, end + tag.length);
}

async function waitBlocked(observer, blocked, blocker) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const result = await observer.query("SELECT $2::int = ANY(pg_catalog.pg_blocking_pids($1)) AS blocked", [blocked, blocker]);
    if (result.rows[0].blocked) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error("proof did not reach its observed lock barrier");
}

async function transaction(client, query) {
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await query();
    await client.query("COMMIT");
    return { rows: result.rows };
  } catch (error) {
    await client.query("ROLLBACK");
    return { error: error.code ?? error.name, message: error.message };
  }
}

function paidCall(client, {
  eventId,
  reservationId,
  sessionId,
  paidAt,
  projection = provider(),
}) {
  return client.query(`SELECT * FROM public.grainline_stripe_checkout_order_create(
    $1, 1, $2, $3,
    $4::timestamp, $5::jsonb
  )`, [eventId, reservationId, sessionId, paidAt, JSON.stringify(projection)]);
}

async function assertFinalState(controller, { listingId, reservationId, sessionId }) {
  const state = await controller.query(`
    SELECT (
             SELECT count(*)::int
               FROM public."Order"
              WHERE "stripeSessionId" = $3
           ) AS orders,
           (
             SELECT "stockQuantity"
               FROM public."Listing"
              WHERE id = $1
           ) AS stock,
           status,
           "repairClaimedAt" IS NULL AS repair_cleared
      FROM public."CheckoutStockReservation"
     WHERE id = $2
  `, [listingId, reservationId, sessionId]);
  assert.deepEqual(state.rows, [{
    orders: 1,
    stock: 0,
    status: "COMPLETED",
    repair_cleared: true,
  }]);
}

export async function runProof(config = proofConfig()) {
  const clients = [];
  const pending = [];
  let controller;
  try {
    for (let i = 0; i < 3; i += 1) {
      const client = new pg.Client(config);
      clients.push(client);
      await client.connect();
      await client.query("SET statement_timeout = '15s'; SET lock_timeout = '12s'; SET deadlock_timeout = '500ms'");
    }
    [controller] = clients;
    const [, paid, repair] = clients;
    const identity = await controller.query("SELECT current_database() AS db, current_user AS role, host(inet_server_addr()) AS host, current_setting('server_version_num')::int AS version");
    assert.deepEqual({
      db: identity.rows[0].db,
      role: identity.rows[0].role,
      version: Math.floor(identity.rows[0].version / 10000),
    }, {
      db: databaseName, role: "paid_lock_owner", version: 16,
    });
    assert.equal(
      proofServerHostAccepted(
        identity.rows[0].host,
        process.env.GITHUB_ACTIONS === "true",
      ),
      true,
      "proof server is neither local nor a GitHub Actions private service",
    );
    const existing = await controller.query("SELECT count(*)::int AS count FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'");
    assert.equal(existing.rows[0].count, 0, "proof refuses a nonempty database");
    await controller.query(paidCheckoutFixtureSql());
    await controller.query(`
      ALTER TABLE public."CheckoutStockReservation"
        ADD COLUMN "checkoutLockKey" text,
        ADD COLUMN "repairGeneration" bigint NOT NULL DEFAULT 1,
        ADD COLUMN "repairClaimedAt" timestamp DEFAULT CURRENT_TIMESTAMP,
        ADD COLUMN "repairClaimKind" text DEFAULT 'SESSION',
        ADD COLUMN "lastRepairError" text,
        ADD COLUMN "lastRepairAttemptAt" timestamp,
        ADD COLUMN "expiresAt" timestamp,
        ADD COLUMN "updatedAt" timestamp,
        ADD COLUMN "reservedItems" jsonb DEFAULT '[]',
        ADD COLUMN "restoredAt" timestamp,
        ADD COLUMN "restoreReason" text;
      DROP FUNCTION public.grainline_checkout_reservation_complete(text,bigint,text,text);
    `);
    const predecessor = fs.readFileSync(path.join(root, "prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql"), "utf8");
    for (const name of ["grainline_checkout_reservation_complete", "grainline_checkout_reservation_repair_finalize"]) {
      const sql = actualFunction(predecessor, name);
      await controller.query(sql);
      const body = await controller.query("SELECT prosrc FROM pg_catalog.pg_proc WHERE proname=$1", [name]);
      assert.equal(body.rows.length, 1);
      assert.equal(body.rows[0].prosrc, sql.split(`AS $${name}$`)[1].split(`$${name}$;`)[0]);
    }
    await controller.query(fs.readFileSync(path.join(root, "docs/rls-drafts/order-paid-checkout-authority.sql"), "utf8"));
    await controller.query(`
      REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_complete(text,bigint,text,text) FROM PUBLIC;
      REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_repair_finalize(text,bigint,text) FROM PUBLIC;
      GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_complete(text,bigint,text,text), public.grainline_checkout_reservation_repair_finalize(text,bigint,text) TO grainline_app_runtime;
      CREATE FUNCTION public.paid_lock_test_barrier() RETURNS trigger LANGUAGE plpgsql AS $b$
      BEGIN
        IF NEW."stripeSessionId" = 'cs_test_proof' THEN
          PERFORM pg_catalog.pg_advisory_xact_lock(1907337, 1);
        END IF;
        RETURN NEW;
      END $b$;
      CREATE TRIGGER paid_lock_test_barrier BEFORE INSERT ON public."Order"
        FOR EACH ROW EXECUTE FUNCTION public.paid_lock_test_barrier();
    `);
    const pids = [];
    for (const client of clients) pids.push((await client.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    const paidAt = (await controller.query(`
      SELECT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')::timestamp AS paid_at
    `)).rows[0].paid_at;
    await controller.query("SELECT pg_advisory_lock(1907337, 1)");
    const paidFirst = {
      eventId: "evt_paid_order",
      reservationId: "reservation-1",
      sessionId: "cs_test_proof",
      paidAt,
    };
    const paidResult = transaction(paid, () => paidCall(paid, paidFirst));
    pending.push(paidResult);
    await waitBlocked(controller, pids[1], pids[0]);
    const repairResult = transaction(repair, () => repair.query(`SELECT * FROM public.grainline_checkout_reservation_repair_finalize('reservation-1', 1, 'PAID_OR_COMPLETE')`));
    pending.push(repairResult);
    await waitBlocked(controller, pids[2], pids[1]);
    await controller.query("SELECT pg_advisory_unlock(1907337, 1)");
    const [paidOutcome, repairOutcome] = await Promise.all([paidResult, repairResult]);
    // Only synthetic outcomes/SQLSTATE are logged, never connection values.
    console.log(JSON.stringify({ paid: paidOutcome.error ?? paidOutcome.rows[0].outcome, repair: repairOutcome.error ?? repairOutcome.rows[0].result }));
    assert.equal(paidOutcome.error, undefined, `paid operation failed: ${paidOutcome.error}`);
    assert.equal(repairOutcome.error, undefined, `repair operation failed: ${repairOutcome.error}`);
    assert.equal(paidOutcome.rows[0].invalid_reason, null);
    assert.equal(repairOutcome.rows[0].result, "superseded");
    await assertFinalState(controller, {
      listingId: "listing-1",
      reservationId: paidFirst.reservationId,
      sessionId: paidFirst.sessionId,
    });
    const replay = await transaction(paid, () => paidCall(paid, paidFirst));
    assert.equal(replay.rows?.[0].outcome, "replayed");

    const repairFirst = {
      eventId: "evt_repair_first",
      reservationId: "reservation-repair-first",
      sessionId: "cs_test_repairfirst",
      paidAt,
    };
    const repairFirstSnapshot = sourceSnapshot();
    repairFirstSnapshot.item.listing.id = "listing-repair-first";
    await controller.query(`
      INSERT INTO public."Listing" (
        id, "sellerId", status, "listingType", "stockQuantity", "isPrivate"
      ) VALUES ('listing-repair-first', 'seller-1', 'ACTIVE', 'IN_STOCK', 0, false)
    `);
    await controller.query(`
      INSERT INTO public."StripeWebhookEvent" (
        id, type, "sourceObjectId", "claimGeneration", "processingStartedAt"
      ) VALUES ($1, 'checkout.session.completed', $2, 1, CURRENT_TIMESTAMP)
    `, [repairFirst.eventId, repairFirst.sessionId]);
    await controller.query(`
      INSERT INTO public."CheckoutStockReservation" (
        id, "stripeSessionId", status, "buyerId", "sellerId", "sourceSnapshot"
      ) VALUES ($1, $2, 'RESERVED', 'buyer-1', 'seller-1', $3::jsonb)
    `, [
      repairFirst.reservationId,
      repairFirst.sessionId,
      JSON.stringify(repairFirstSnapshot),
    ]);
    const repairFirstProjection = provider({
      stripePaymentIntentId: "pi_repair_first",
      stripeChargeId: "ch_repair_first",
      stripeApplicationFeeId: "fee_repair_first",
      stripeTransferId: "tr_repair_first",
      paidItems: [{
        ...provider().paidItems[0],
        sourceKey: "single:listing-repair-first",
        listingId: "listing-repair-first",
      }],
    });

    await controller.query("BEGIN");
    await controller.query(`
      SELECT 1
        FROM public."CheckoutStockReservation"
       WHERE id = $1
       FOR UPDATE
    `, [repairFirst.reservationId]);
    const repairFirstResult = transaction(repair, () => repair.query(`
      SELECT *
        FROM public.grainline_checkout_reservation_repair_finalize($1, 1, 'PAID_OR_COMPLETE')
    `, [repairFirst.reservationId]));
    pending.push(repairFirstResult);
    await waitBlocked(controller, pids[2], pids[0]);
    const paidAfterRepairResult = transaction(paid, () => paidCall(paid, {
      ...repairFirst,
      projection: repairFirstProjection,
    }));
    pending.push(paidAfterRepairResult);
    await waitBlocked(controller, pids[1], pids[2]);
    await controller.query("COMMIT");
    const [repairFirstOutcome, paidAfterRepairOutcome] = await Promise.all([
      repairFirstResult,
      paidAfterRepairResult,
    ]);
    console.log(JSON.stringify({
      repairFirst: repairFirstOutcome.error ?? repairFirstOutcome.rows[0].result,
      paidAfterRepair: paidAfterRepairOutcome.error ?? paidAfterRepairOutcome.rows[0].outcome,
    }));
    assert.equal(repairFirstOutcome.error, undefined, `repair-first operation failed: ${repairFirstOutcome.error}`);
    assert.equal(paidAfterRepairOutcome.error, undefined, `paid-after-repair operation failed: ${paidAfterRepairOutcome.error}`);
    assert.equal(repairFirstOutcome.rows[0].result, "deferred");
    assert.equal(paidAfterRepairOutcome.rows[0].invalid_reason, null);
    await assertFinalState(controller, {
      listingId: "listing-repair-first",
      reservationId: repairFirst.reservationId,
      sessionId: repairFirst.sessionId,
    });
    const repairFirstReplay = await transaction(paid, () => paidCall(paid, {
      ...repairFirst,
      projection: repairFirstProjection,
    }));
    assert.equal(repairFirstReplay.rows?.[0].outcome, "replayed");
    console.log("Paid/repair lock proof passed in both observed orders, including replay and stock conservation.");
  } finally {
    if (controller) {
      await controller.query("ROLLBACK").catch(() => {});
      await controller.query("SELECT pg_advisory_unlock_all()").catch(() => {});
    }
    await Promise.allSettled(pending);
    await Promise.allSettled(clients.map((client) => client.end()));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runProof().catch((error) => {
    console.error(`Paid/repair proof failed: ${error.code ?? error.name}: ${String(error.message).replace(/postgres(?:ql)?:\/\/[^\s]+/g, '[redacted-url]')}`);
    process.exitCode = 1;
  });
}
