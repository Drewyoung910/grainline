import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import {
  buildCheckoutReservationRepairOutcomeCorrection,
  repairPredecessorDefinition,
} from "../scripts/build-checkout-reservation-repair-outcome-correction.mjs";

const draft = readFileSync("docs/rls-drafts/checkout-reservation-repair-outcome-correction.sql", "utf8");
const predecessor = repairPredecessorDefinition();
const history = readFileSync("prisma/migrations/20260810190000_prepare_checkout_stock_reservation_authority/migration.sql", "utf8");
const helperName = "grainline_checkout_reservation_restore_items";
const helperStart = history.indexOf(`CREATE FUNCTION public.${helperName}(`);
const helperEnd = history.indexOf(`$${helperName}$;`, helperStart);
const restoreHelper = history.slice(helperStart, helperEnd + helperName.length + 3);

async function database() {
  const db = new PGlite();
  await db.exec(`
    CREATE ROLE neondb_owner SUPERUSER;
    CREATE ROLE grainline_app_runtime NOINHERIT NOBYPASSRLS;
    SET ROLE neondb_owner;
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY, "listingType" text NOT NULL DEFAULT 'IN_STOCK',
      "stockQuantity" integer NOT NULL DEFAULT 0, status text NOT NULL DEFAULT 'SOLD_OUT'
    );
    CREATE TABLE public."Order" (id text PRIMARY KEY, "stripeSessionId" text UNIQUE);
    CREATE TABLE public."CheckoutStockReservation" (
      id text PRIMARY KEY, "stripeSessionId" text, "checkoutLockKey" text,
      "repairGeneration" bigint NOT NULL DEFAULT 1,
      "repairClaimedAt" timestamp DEFAULT CURRENT_TIMESTAMP,
      "repairClaimKind" text DEFAULT 'SESSION',
      status text NOT NULL DEFAULT 'RESERVED', "reservedItems" jsonb NOT NULL,
      "restoredAt" timestamp, "restoreReason" text, "lastRepairError" text,
      "lastRepairAttemptAt" timestamp, "expiresAt" timestamp,
      "updatedAt" timestamp DEFAULT CURRENT_TIMESTAMP
    );
    ALTER TABLE public."CheckoutStockReservation" ENABLE ROW LEVEL SECURITY;
    ALTER TABLE public."CheckoutStockReservation" FORCE ROW LEVEL SECURITY;
    ${restoreHelper}
    ${predecessor}
    REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_restore_items(jsonb) FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.grainline_checkout_reservation_repair_finalize(text,bigint,text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_repair_finalize(text,bigint,text) TO grainline_app_runtime;
  `);
  return db;
}

async function seed(db, id, session = null) {
  await db.query('INSERT INTO public."Listing" (id) VALUES ($1)', [id]);
  await db.query(`INSERT INTO public."CheckoutStockReservation"
    (id, "stripeSessionId", "checkoutLockKey", "reservedItems")
    VALUES ($1, $2, $3, $4::jsonb)`,
  [id, session, `checkout:${id}`, JSON.stringify([{ listingId: id, quantity: 1 }])]);
}

async function call(db, id, outcome, generation = 1) {
  await db.exec("SET ROLE grainline_app_runtime");
  try {
    return (await db.query(`SELECT * FROM public.grainline_checkout_reservation_repair_finalize($1,$2,$3)`,
      [id, generation, outcome])).rows[0];
  } finally { await db.exec("SET ROLE neondb_owner"); }
}

async function state(db, id) {
  return (await db.query(`SELECT to_jsonb(r) AS reservation, to_jsonb(l) AS listing
    FROM public."CheckoutStockReservation" r JOIN public."Listing" l ON l.id = r.id WHERE r.id = $1`, [id])).rows;
}

test("draft reproduces exactly and changes only the NULL outcome guard in the function", () => {
  assert.equal(draft.trimEnd(), buildCheckoutReservationRepairOutcomeCorrection().trimEnd());
  const tag = "$grainline_checkout_reservation_repair_finalize$";
  assert.equal(draft.split(tag)[1], predecessor.split(tag)[1]
    .replace("OR p_outcome NOT IN (", "OR p_outcome IS NULL OR p_outcome NOT IN ("));
});

test("the historical runtime function restores stock for NULL even with a bound session", async () => {
  const db = await database();
  try {
    await seed(db, "old", "cs_bound");
    assert.equal((await call(db, "old", null)).result, "restored");
    assert.equal((await state(db, "old"))[0].listing.stockQuantity, 1);
  } finally { await db.close(); }
});

test("corrected runtime rejects malformed outcomes before any stock or lease changes", async () => {
  const db = await database();
  try {
    await db.exec(draft);
    for (const session of [null, "cs_bound"]) {
      const id = session ? "bound" : "unbound";
      await seed(db, id, session);
      const before = await state(db, id);
      for (const outcome of [null, "", "RESTORE", "NO_SESSION_RESTORE ", "session_expired_restore"]) {
        await assert.rejects(call(db, id, outcome), /Checkout repair finalizer input is invalid/);
        assert.deepEqual(await state(db, id), before);
      }
    }
    await db.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(db.query('SELECT * FROM public."CheckoutStockReservation"'), /permission denied/);
    await assert.rejects(db.query("SELECT public.grainline_checkout_reservation_restore_items('[]')"), /permission denied/);
  } finally { await db.close(); }
});

test("all legitimate outcomes preserve restore, deferral, replay and generation behavior", async () => {
  const db = await database();
  try {
    await db.exec(draft);
    for (const [i, outcome] of ["NO_SESSION_RESTORE", "SESSION_EXPIRED_RESTORE",
      "PAID_OR_COMPLETE", "RETRIEVE_FAILED", "UNRECOGNIZED", "EXPIRE_FAILED"].entries()) {
      const id = `valid-${i}`;
      await seed(db, id, i === 0 ? null : `cs_valid_${i}`);
      const before = await state(db, id);
      assert.equal((await call(db, id, outcome, 2)).result, "superseded");
      assert.deepEqual(await state(db, id), before);
      assert.equal((await call(db, id, outcome)).result, i < 2 ? "restored" : "deferred");
      assert.equal((await state(db, id))[0].listing.stockQuantity, i < 2 ? 1 : 0);
      // A cleared claim cannot authorize another restore with the same generation.
      assert.equal((await call(db, id, outcome)).result, "superseded");
      assert.equal((await state(db, id))[0].listing.stockQuantity, i < 2 ? 1 : 0);
    }
    for (const [id, session, outcome] of [["mismatch-bound", "cs_mismatch", "NO_SESSION_RESTORE"],
      ["mismatch-empty", null, "SESSION_EXPIRED_RESTORE"]]) {
      await seed(db, id, session);
      const before = await state(db, id);
      await assert.rejects(call(db, id, outcome), /outcome does not match/);
      assert.deepEqual(await state(db, id), before);
    }
    await seed(db, "paid", "cs_paid");
    await db.exec(`INSERT INTO public."Order" VALUES ('order-paid', 'cs_paid')`);
    assert.equal((await call(db, "paid", "SESSION_EXPIRED_RESTORE")).result, "completed");
    assert.equal((await state(db, "paid"))[0].listing.stockQuantity, 0);
    assert.equal((await call(db, "absent", "NO_SESSION_RESTORE")).result, "absent");
  } finally { await db.close(); }
});

test("draft rejects predecessor source, ACL and FORCE posture drift before replacement", async () => {
  for (const mutation of [
    predecessor.replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION").replace("BEGIN", "BEGIN\n-- drift"),
    "GRANT EXECUTE ON FUNCTION public.grainline_checkout_reservation_repair_finalize(text,bigint,text) TO PUBLIC",
    "GRANT SELECT ON public.\"CheckoutStockReservation\" TO grainline_app_runtime",
    "ALTER TABLE public.\"CheckoutStockReservation\" NO FORCE ROW LEVEL SECURITY",
  ]) {
    const db = await database();
    try {
      await db.exec(mutation);
      const identity = `SELECT prosrc, proacl::text FROM pg_catalog.pg_proc
        WHERE oid = 'public.grainline_checkout_reservation_repair_finalize(text,bigint,text)'::regprocedure`;
      const before = (await db.query(identity)).rows;
      await assert.rejects(db.exec(draft), /Checkout repair before .* drifted/);
      await db.exec("ROLLBACK");
      assert.deepEqual((await db.query(identity)).rows, before);
    } finally { await db.close(); }
  }
});
