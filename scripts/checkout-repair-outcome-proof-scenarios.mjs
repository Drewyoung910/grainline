import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Fixtures are committed only in the disposable clone so a distinct runtime
// login can see them. No fake columns, disabled constraints or production IDs.
export async function seedRepairOutcomeFixture(owner, { bound = true, kind = "CRON", paid = false, claimed = true } = {}) {
  const prefix = `repair-proof-${randomUUID()}`;
  const ids = Object.fromEntries(["buyer", "seller", "profile", "listing", "reservation", "order", "item"]
    .map((key) => [key, `${prefix}-${key}`]));
  ids.session = bound ? `cs_test_${randomUUID().replaceAll("-", "")}` : null;
  ids.lock = `checkout:${ids.reservation}`;
  await owner.query("BEGIN");
  try {
    for (const key of ["buyer", "seller"]) await owner.query(`INSERT INTO public."User"
      (id,"clerkId",email,"updatedAt") VALUES ($1,$2,$3,timezone('UTC',now()))`,
    [ids[key], `clerk-${ids[key]}`, `${ids[key]}@example.invalid`]);
    await owner.query(`INSERT INTO public."SellerProfile" (id,"userId","displayName","displayNameNormalized","updatedAt")
      VALUES ($1,$2,$3,$3,timezone('UTC',now()))`, [ids.profile, ids.seller, prefix]);
    await owner.query(`INSERT INTO public."Listing" (id,"sellerId",title,description,"priceCents",
      "listingType","stockQuantity",status,"updatedAt")
      VALUES ($1,$2,'Disposable repair proof','Disposable stock restoration proof',500,
        'IN_STOCK',0,'SOLD_OUT',timezone('UTC',now()))`, [ids.listing, ids.profile]);
    await owner.query(`INSERT INTO public."CheckoutStockReservation"
      (id,"checkoutLockKey","payloadHash","buyerId","sellerId","stripeSessionId",status,
       "reservedItems","expiresAt","repairGeneration","repairClaimedAt","repairClaimKind","updatedAt")
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,timezone('UTC',now())-interval '3 hours',1,
        CASE WHEN $9 THEN timezone('UTC',now()) END,CASE WHEN $9 THEN $10::text END,timezone('UTC',now()))`,
    [ids.reservation, ids.lock, "R".repeat(32), ids.buyer, ids.profile, ids.session,
      bound ? "SESSION_CREATED" : "RESERVED", JSON.stringify([{ listingId: ids.listing, sellerId: ids.profile, quantity: 1 }]), claimed, kind]);
    if (paid) {
      assert.ok(bound);
      await owner.query(`INSERT INTO public."Order" (id,"buyerId","stripeSessionId","stripeChargeId",
        "itemsSubtotalCents","shippingAmountCents","taxAmountCents","paidAt")
        VALUES ($1,$2,$3,$4,500,0,0,timezone('UTC',now()))`, [ids.order, ids.buyer, ids.session, `ch_test_${prefix}`]);
      await owner.query(`INSERT INTO public."OrderItem" (id,"orderId","listingId",quantity,"priceCents")
        VALUES ($1,$2,$3,1,500)`, [ids.item, ids.order, ids.listing]);
    }
    await owner.query("COMMIT");
    return ids;
  } catch (error) { await owner.query("ROLLBACK"); throw error; }
}

export async function repairOutcomeState(owner, ids) {
  const { rows } = await owner.query(`SELECT to_jsonb(r) AS reservation, to_jsonb(l) AS listing,
    (SELECT count(*)::integer FROM public."Order" WHERE "stripeSessionId"=$3) AS orders
    FROM public."CheckoutStockReservation" r CROSS JOIN public."Listing" l
    WHERE r.id=$1 AND l.id=$2`, [ids.reservation, ids.listing, ids.session]);
  assert.equal(rows.length, 1);
  return rows[0];
}

export async function callRepairOutcome(runtime, ids, outcome, generation = 1) {
  const { rows } = await runtime.query(`SELECT * FROM public.grainline_checkout_reservation_repair_finalize($1,$2,$3)`,
    [ids.reservation, generation, outcome]);
  assert.equal(rows.length, 1);
  return rows[0];
}

const OUTCOMES = ["NO_SESSION_RESTORE", "SESSION_EXPIRED_RESTORE", "PAID_OR_COMPLETE", "RETRIEVE_FAILED", "UNRECOGNIZED", "EXPIRE_FAILED"];
const ERRORS = [null, null, "paid_missing_local_order", "session_retrieve_failed", "unrecognized_session_state", "session_expire_failed"];
export async function proveRepairOutcomeScenarios(owner, runtime, phase = () => {}) {
  let invalidInputs = 0;
  let legitimateOutcomes = 0;
  const denied = (sql, params, code, message) => assert.rejects(runtime.query(sql, params),
    (error) => error.code === code && error.message.includes(message));
  for (const kind of ["CRON", "ACCOUNT"]) {
    for (const bound of [false, true]) {
      phase(`reject-${kind}-${bound ? "bound" : "unbound"}`);
      const ids = await seedRepairOutcomeFixture(owner, { bound, kind });
      const before = await repairOutcomeState(owner, ids);
      for (const invalid of [null, "", "unknown", "NO_SESSION_RESTORE ", "session_expired_restore"]) {
        await assert.rejects(callRepairOutcome(runtime, ids, invalid),
          (error) => error.code === "23514" && error.message.includes("finalizer input is invalid"));
        assert.deepEqual(await repairOutcomeState(owner, ids), before);
        invalidInputs++;
      }
    }
    for (const [index, outcome] of OUTCOMES.entries()) {
      phase(`legitimate-${kind}-${index + 1}`);
      const ids = await seedRepairOutcomeFixture(owner, { bound: index !== 0, kind });
      const before = await repairOutcomeState(owner, ids);
      assert.equal((await callRepairOutcome(runtime, ids, outcome, 2)).result, "superseded");
      assert.deepEqual(await repairOutcomeState(owner, ids), before);
      const result = await callRepairOutcome(runtime, ids, outcome);
      assert.deepEqual(result, { result: index < 2 ? "restored" : "deferred",
        checkout_lock_key: ids.lock, stripe_session_id: ids.session, stock_visibility_changed: index < 2 ? 1 : 0 });
      const after = await repairOutcomeState(owner, ids);
      assert.equal(after.listing.stockQuantity, index < 2 ? 1 : 0);
      assert.equal(after.listing.status, index < 2 ? "ACTIVE" : "SOLD_OUT");
      assert.equal(after.reservation.status, index < 2 ? "RESTORED" : "SESSION_CREATED");
      assert.equal(after.reservation.repairClaimedAt, null);
      assert.equal(after.reservation.repairClaimKind, null);
      assert.equal(after.reservation.lastRepairError, ERRORS[index]);
      const reason = kind === "ACCOUNT"
        ? (index === 0 ? "account_deletion_no_session" : "account_deletion_stripe_session_unpaid")
        : (index === 0 ? "stale_no_session" : "stale_stripe_session_unpaid");
      assert.equal(after.reservation.restoreReason, index < 2 ? reason : null);
      assert.equal((await callRepairOutcome(runtime, ids, outcome)).result, "superseded");
      assert.deepEqual(await repairOutcomeState(owner, ids), after, "exact retry changed stock or reservation");
      legitimateOutcomes++;
    }
  }
  for (const bound of [false, true]) {
    phase(`session-mismatch-${bound}`);
    const ids = await seedRepairOutcomeFixture(owner, { bound });
    const before = await repairOutcomeState(owner, ids);
    await assert.rejects(callRepairOutcome(runtime, ids, bound ? "NO_SESSION_RESTORE" : "SESSION_EXPIRED_RESTORE"),
      (error) => error.code === "23514" && error.message.includes("does not match reservation session state"));
    assert.deepEqual(await repairOutcomeState(owner, ids), before);
  }
  phase("already-paid-order");
  const paid = await seedRepairOutcomeFixture(owner, { paid: true });
  assert.equal((await callRepairOutcome(runtime, paid, "SESSION_EXPIRED_RESTORE")).result, "completed");
  const paidState = await repairOutcomeState(owner, paid);
  assert.equal(paidState.orders, 1);
  assert.equal(paidState.listing.stockQuantity, 0);
  assert.equal(paidState.reservation.status, "COMPLETED");
  assert.equal(paidState.reservation.repairClaimedAt, null);
  assert.equal((await callRepairOutcome(runtime, paid, "SESSION_EXPIRED_RESTORE")).result, "superseded");
  assert.deepEqual(await repairOutcomeState(owner, paid), paidState);
  phase("unclaimed-and-absent");
  const unclaimed = await seedRepairOutcomeFixture(owner, { claimed: false });
  const before = await repairOutcomeState(owner, unclaimed);
  assert.equal((await callRepairOutcome(runtime, unclaimed, "SESSION_EXPIRED_RESTORE")).result, "superseded");
  assert.deepEqual(await repairOutcomeState(owner, unclaimed), before);
  assert.deepEqual(await callRepairOutcome(runtime, { reservation: `missing-${randomUUID()}` }, "NO_SESSION_RESTORE"),
    { result: "absent", checkout_lock_key: null, stripe_session_id: null, stock_visibility_changed: 0 });
  phase("direct-authority-denial");
  for (const sql of ['SELECT * FROM public."CheckoutStockReservation" LIMIT 1',
    'UPDATE public."CheckoutStockReservation" SET status=status WHERE false',
    'DELETE FROM public."CheckoutStockReservation" WHERE false',
    'INSERT INTO public."CheckoutStockReservation" (id) VALUES (NULL)',
    'TRUNCATE public."CheckoutStockReservation"',
    "SELECT public.grainline_checkout_reservation_restore_items('[]'::jsonb)"]) {
    await denied(sql, [], "42501", "permission denied");
  }
  return { invalidInputs, legitimateOutcomes, sessionMismatchControls: 2, paidOrderPreserved: true,
    unclaimedAndAbsentPreserved: true, directDenials: 6 };
}
