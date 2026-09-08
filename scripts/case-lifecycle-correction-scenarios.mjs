import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

// Shared by the small engine fixture and the rollback-only full-schema CI proof.
// Callers own the transaction; each scenario leaves no rows even on failure.
export async function caseLifecycleFixture(client) {
  const prefix = `case-lifecycle-${randomUUID()}`;
  const ids = Object.fromEntries(["buyer", "seller", "staff", "foreign", "profile", "listing", "order"]
    .map((key) => [key, `${prefix}-${key}`]));
  for (const key of ["buyer", "seller", "staff", "foreign"]) {
    await client.query(`INSERT INTO public."User"
      (id,"clerkId",email,name,role,"createdAt","updatedAt")
      VALUES ($1,$2,$3,'Disposable Case lifecycle proof',$4::public."Role",now(),now())`,
    [ids[key], `clerk-${ids[key]}`, `${key}-${randomUUID()}@example.invalid`, key === "staff" ? "ADMIN" : "USER"]);
  }
  await client.query(`INSERT INTO public."SellerProfile"
    (id,"userId","displayName","displayNameNormalized","createdAt","updatedAt")
    VALUES ($1,$2,$3,$3,now(),now())`, [ids.profile, ids.seller, prefix]);
  await client.query(`INSERT INTO public."Listing"
    (id,"sellerId",title,description,"priceCents","createdAt","updatedAt")
    VALUES ($1,$2,'Disposable proof','Disposable Case lifecycle proof',500,now(),now())`, [ids.listing, ids.profile]);
  await client.query(`INSERT INTO public."Order" (id,"buyerId","stripeChargeId",
    "itemsSubtotalCents","shippingAmountCents","taxAmountCents","paidAt",
    "fulfillmentStatus","estimatedDeliveryDate","deliveredAt")
    VALUES ($1,$2,$3,500,0,0,timezone('UTC',now()),'DELIVERED',
      timezone('UTC',now()) + interval '1 day', timezone('UTC',now()))`, [ids.order, ids.buyer, `${prefix}-charge`]);
  await client.query(`INSERT INTO public."OrderItem" (id,"orderId","listingId",quantity,"priceCents")
    VALUES ($1,$2,$3,1,500)`, [`${prefix}-item`, ids.order, ids.listing]);
  return ids;
}

export async function caseLifecycleRuntime(client, sql, params = []) {
  await client.query("SAVEPOINT lifecycle_call");
  try {
    // Disposable SQL role behavior, NOT a production runtime-login claim.
    await client.query("SET LOCAL ROLE grainline_app_runtime");
    const result = await client.query(sql, params);
    await client.query("RESET ROLE");
    await client.query("RELEASE SAVEPOINT lifecycle_call");
    return result;
  } catch (error) {
    await client.query("ROLLBACK TO SAVEPOINT lifecycle_call");
    await client.query("RELEASE SAVEPOINT lifecycle_call");
    throw error;
  }
}

export async function openLifecycleCase(client, ids, actor = ids.buyer, reason = "DAMAGED") {
  const { rows } = await caseLifecycleRuntime(client,
    "SELECT public.grainline_case_open($1,$2,$3,$4) AS result",
    [actor, ids.order, reason, "The received item is damaged; please review this exact order."]);
  return rows[0].result;
}
export async function pendingLifecycleCase(client, ids, markedBy = "seller") {
  // Use the actual opening authority, including its durable application/message.
  await client.query(`UPDATE public."Order" SET "estimatedDeliveryDate"=timezone('UTC',now())-interval '1 day'
    WHERE id=$1`, [ids.order]);
  const opened = await openLifecycleCase(client, ids);
  await client.query(`UPDATE public."Case" SET status='IN_DISCUSSION',
    "discussionStartedAt"=timezone('UTC',now()), "escalateUnlocksAt"=timezone('UTC',now())+interval '2 days'
    WHERE id=$1`, [opened.caseId]);
  await client.query(`UPDATE public."Case" SET status='PENDING_CLOSE',
    "buyerMarkedResolved"=$2, "sellerMarkedResolved"=$3 WHERE id=$1`,
  [opened.caseId, markedBy === "buyer", markedBy === "seller"]);
  return opened.caseId;
}
export async function escalateLifecycleCase(client, ids, caseId, actor = ids.buyer) {
  const { rows } = await caseLifecycleRuntime(client,
    "SELECT public.grainline_case_escalate($1,$2) AS result", [actor, caseId]);
  return rows[0].result;
}

async function rejected(run, code) {
  await assert.rejects(run, (error) => error.code === code);
}

export const caseLifecycleScenarios = [
  ...["DELIVERED", "PICKED_UP"].map((status) => ({ name: `early ${status} can open and exactly replay`,
    async run(client, ids) {
      await client.query(`UPDATE public."Order" SET "fulfillmentStatus"=$2::public."FulfillmentStatus",
        "deliveredAt"=CASE WHEN $2='DELIVERED' THEN timezone('UTC',now()) END,
        "pickedUpAt"=CASE WHEN $2='PICKED_UP' THEN timezone('UTC',now()) END WHERE id=$1`, [ids.order, status]);
      const first = await openLifecycleCase(client, ids);
      assert.equal(first.action, "created");
      assert.equal((await openLifecycleCase(client, ids)).caseId, first.caseId);
      assert.equal((await openLifecycleCase(client, ids)).action, "replay");
      await rejected(() => openLifecycleCase(client, ids, ids.buyer, "WRONG_ITEM"), "23505");
    } })),
  { name: "an unreceived future shipment still waits for its estimate", async run(client, ids) {
    await client.query(`UPDATE public."Order" SET "fulfillmentStatus"='SHIPPED',"deliveredAt"=NULL WHERE id=$1`, [ids.order]);
    await rejected(() => openLifecycleCase(client, ids), "23514");
    await client.query(`UPDATE public."Order" SET "estimatedDeliveryDate"=timezone('UTC',now())-interval '1 day' WHERE id=$1`, [ids.order]);
    assert.equal((await openLifecycleCase(client, ids)).action, "created");
  } },
  { name: "early receipt does not waive the thirty-day closing deadline", async run(client, ids) {
    await client.query(`UPDATE public."Order" SET "deliveredAt"=timezone('UTC',now())-interval '31 days' WHERE id=$1`, [ids.order]);
    await rejected(() => openLifecycleCase(client, ids), "23514");
  } },
  { name: "receipt with absent estimate still works", async run(client, ids) {
    await client.query(`UPDATE public."Order" SET "estimatedDeliveryDate"=NULL WHERE id=$1`, [ids.order]);
    assert.equal((await openLifecycleCase(client, ids)).action, "created");
  } },
  { name: "unavailable seller exception still permits a complaint before the estimate", async run(client, ids) {
    await client.query(`UPDATE public."Order" SET "fulfillmentStatus"='SHIPPED',"deliveredAt"=NULL WHERE id=$1`, [ids.order]);
    await client.query(`UPDATE public."User" SET banned=true WHERE id=$1`, [ids.seller]);
    assert.equal((await openLifecycleCase(client, ids)).action, "created");
  } },
  { name: "review-needed exception does not bypass purchased-label protection", async run(client, ids) {
    await client.query(`UPDATE public."Order" SET "fulfillmentStatus"='PENDING',"deliveredAt"=NULL,
      "reviewNeeded"=true,"labelStatus"='PURCHASED' WHERE id=$1`, [ids.order]);
    await rejected(() => openLifecycleCase(client, ids), "23514");
    await client.query(`UPDATE public."Order" SET "labelStatus"=NULL WHERE id=$1`, [ids.order]);
    assert.equal((await openLifecycleCase(client, ids)).action, "created");
  } },
  { name: "foreign actors, unpaid orders and refund claims remain blocked", async run(client, ids) {
    await rejected(() => openLifecycleCase(client, ids, ids.foreign), "42501");
    await client.query(`UPDATE public."Order" SET "paidAt"=NULL WHERE id=$1`, [ids.order]);
    await rejected(() => openLifecycleCase(client, ids), "23514");
    await client.query(`UPDATE public."Order" SET "paidAt"=timezone('UTC',now()),
      "sellerRefundId"='pending',"sellerRefundLockedAt"=timezone('UTC',now()) WHERE id=$1`, [ids.order]);
    await rejected(() => openLifecycleCase(client, ids), "23505");
  } },
  ...["buyer", "seller"].flatMap((actor) => ["banned", "deleted"].map((unavailable) => ({
    name: `${actor} pending-close objection with ${unavailable} counterparty`,
    async run(client, ids) {
      const other = actor === "buyer" ? "seller" : "buyer";
      const caseId = await pendingLifecycleCase(client, ids, other);
      await client.query(`UPDATE public."User" SET banned=$2,
        "deletedAt"=CASE WHEN $3 THEN timezone('UTC',now()) END WHERE id=$1`,
      [ids[other], unavailable === "banned", unavailable === "deleted"]);
      const first = await escalateLifecycleCase(client, ids, caseId, ids[actor]);
      assert.equal(first.previousStatus, "PENDING_CLOSE");
      assert.equal(first.status, "UNDER_REVIEW");
      const replay = await escalateLifecycleCase(client, ids, caseId, ids[actor]);
      assert.equal(replay.action, "replay");
      assert.equal(replay.auditLogId, first.auditLogId);
      const { rows: [row] } = await client.query(`SELECT "buyerMarkedResolved","sellerMarkedResolved",resolution
        FROM public."Case" WHERE id=$1`, [caseId]);
      assert.deepEqual(row, { buyerMarkedResolved: false, sellerMarkedResolved: false, resolution: null });
      // Even if the worker wakes after the old objection cutoff, review is not
      // a pending-close candidate. Test the unchanged real cron function.
      await client.query(`UPDATE public."Case" SET "updatedAt"=timezone('UTC',now())-interval '8 days' WHERE id=$1`, [caseId]);
      const cron = await caseLifecycleRuntime(client,
        "SELECT * FROM public.grainline_case_cron_transition_batch('PENDING_CLOSE_EXPIRED',100)");
      assert.ok(!cron.rows.some((row) => row.caseId === caseId));
      assert.equal((await client.query(`SELECT status FROM public."Case" WHERE id=$1`, [caseId])).rows[0].status, "UNDER_REVIEW");
      await rejected(() => escalateLifecycleCase(client, ids, caseId, ids.foreign), "42501");
    },
  }))),
  { name: "available pending-close still uses ordinary discussion rather than bypassing it", async run(client, ids) {
    const caseId = await pendingLifecycleCase(client, ids);
    await client.query(`UPDATE public."Case" SET "escalateUnlocksAt"=timezone('UTC',now())-interval '1 day' WHERE id=$1`, [caseId]);
    await rejected(() => escalateLifecycleCase(client, ids, caseId), "23514");
  } },
  { name: "the party who already agreed can withdraw that consent when the other party becomes unavailable", async run(client, ids) {
    const caseId = await pendingLifecycleCase(client, ids, "buyer");
    await client.query(`UPDATE public."User" SET banned=true WHERE id=$1`, [ids.seller]);
    assert.equal((await escalateLifecycleCase(client, ids, caseId)).status, "UNDER_REVIEW");
    assert.equal((await client.query(`SELECT "buyerMarkedResolved" FROM public."Case" WHERE id=$1`, [caseId])).rows[0].buyerMarkedResolved, false);
  } },
  { name: "available discussion keeps the timer and cannot borrow another actor's replay", async run(client, ids) {
    const caseId = await pendingLifecycleCase(client, ids);
    await client.query(`UPDATE public."Case" SET status='IN_DISCUSSION',
      "buyerMarkedResolved"=false,"sellerMarkedResolved"=false WHERE id=$1`, [caseId]);
    await rejected(() => escalateLifecycleCase(client, ids, caseId), "55000");
    await client.query(`UPDATE public."Case" SET "escalateUnlocksAt"=timezone('UTC',now())-interval '1 day' WHERE id=$1`, [caseId]);
    const first = await escalateLifecycleCase(client, ids, caseId);
    assert.equal(first.previousStatus, "IN_DISCUSSION");
    await rejected(() => escalateLifecycleCase(client, ids, caseId, ids.seller), "23514");
    await client.query(`UPDATE public."AdminAuditLog" SET metadata=jsonb_set(metadata,'{previousStatus}','"RESOLVED"') WHERE id=$1`, [first.auditLogId]);
    await rejected(() => escalateLifecycleCase(client, ids, caseId), "23514");
  } },
  { name: "staff can review pending-close and exactly replay without becoming a participant", async run(client, ids) {
    const caseId = await pendingLifecycleCase(client, ids);
    const first = await escalateLifecycleCase(client, ids, caseId, ids.staff);
    assert.equal(first.actorKind, "staff");
    assert.equal((await escalateLifecycleCase(client, ids, caseId, ids.staff)).auditLogId, first.auditLogId);
  } },
  { name: "pending-close relief preserves refund fencing and actor suspension denial", async run(client, ids) {
    const caseId = await pendingLifecycleCase(client, ids);
    await client.query(`UPDATE public."User" SET banned=true WHERE id=$1`, [ids.seller]);
    await client.query(`UPDATE public."Order" SET "sellerRefundLockedAt"=timezone('UTC',now()) WHERE id=$1`, [ids.order]);
    await rejected(() => escalateLifecycleCase(client, ids, caseId), "40001");
    await client.query(`UPDATE public."Order" SET "sellerRefundLockedAt"=NULL WHERE id=$1`, [ids.order]);
    await client.query(`UPDATE public."User" SET banned=true WHERE id=$1`, [ids.buyer]);
    await rejected(() => escalateLifecycleCase(client, ids, caseId), "42501");
  } },
];

export async function runCaseLifecycleScenario(client, scenario) {
  await client.query("SAVEPOINT lifecycle_fixture");
  try {
    const ids = await caseLifecycleFixture(client);
    await scenario.run(client, ids);
    await client.query("SET CONSTRAINTS ALL IMMEDIATE");
  } finally {
    await client.query("ROLLBACK TO SAVEPOINT lifecycle_fixture");
    await client.query("RELEASE SAVEPOINT lifecycle_fixture");
  }
}
