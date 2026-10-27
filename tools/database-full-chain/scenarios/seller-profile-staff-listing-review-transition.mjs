import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function callAsStaff(database, actorId, listingId, operation, reason = "") {
  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    return rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_listing_review_transition($1, $2, $3, $4)`,
      [actorId, listingId, operation, reason],
    ));
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

export async function proveSellerProfileStaffListingReviewTransition({ database, seller }) {
  const actorId = `${seller.userId}_listing_review_admin`;
  const rejectedListingId = `${seller.sellerProfileId}_listing_review_reject`;
  const activeListingId = `${seller.sellerProfileId}_listing_review_active`;
  const soldOutListingId = `${seller.sellerProfileId}_listing_review_soldout`;
  const listingIds = [rejectedListingId, activeListingId, soldOutListingId];
  const now = "2026-10-21 18:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
           ) AS "staffExecute",
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_seller_staff_listing_review_transition(text,text,text,text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "v",
    config: ["search_path=pg_catalog"],
    staffExecute: true,
    runtimeExecute: false,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Listing review admin', 'ADMIN', $4, $4, $4, '2026-01-01', $4)`,
    [
      actorId,
      `user_${actorId}`.slice(0, 191),
      `${actorId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `UPDATE public."SellerProfile"
        SET "ownerAccountActive" = true,
            "chargesEnabled" = true,
            "vacationMode" = false,
            "shippingFlatRateCents" = 1200,
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  for (const [listingId, title, stockQuantity] of [
    [rejectedListingId, "Rejected listing", 1],
    [activeListingId, "Approved listing", 1],
    [soldOutListingId, "Sold out listing", 0],
  ]) {
    await database.query(
      `INSERT INTO public."Listing"
        (id, "sellerId", title, description, "priceCents", currency, status,
         "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt")
       VALUES ($1, $2, $3, 'Staff listing review authority proof', 4200, 'usd',
               'PENDING_REVIEW', 'IN_STOCK', $4, false, $5, $5)`,
      [listingId, seller.sellerProfileId, title, stockQuantity, now],
    );
  }

  const vacationBlocked = await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = true, "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  assert.equal(vacationBlocked.rowCount, 1);
  assert.deepEqual(await callAsStaff(database, actorId, activeListingId, "APPROVE"), [{
    applied: false,
    auditId: null,
    blockReason: "SELLER_VACATION",
    listingId: activeListingId,
    title: "Approved listing",
    priceCents: 4200,
    currency: "usd",
    status: "PENDING_REVIEW",
    listingType: "IN_STOCK",
    stockQuantity: 1,
    sellerProfileId: seller.sellerProfileId,
    customOrderConversationId: null,
    reservedForUserId: null,
    sellerUserId: seller.userId,
    sellerDisplayName: "Full Chain Workshop",
    ownerAccountActive: true,
    chargesEnabled: true,
    vacationMode: true,
  }]);
  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = false, "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );

  const missingReason = await callAsStaff(database, actorId, rejectedListingId, "REJECT");
  assert.equal(missingReason[0].applied, false);
  assert.equal(missingReason[0].blockReason, "REASON_REQUIRED");
  const rejected = await callAsStaff(
    database,
    actorId,
    rejectedListingId,
    "REJECT",
    "Listing needs changes",
  );
  assert.equal(rejected[0].applied, true);
  assert.equal(rejected[0].status, "REJECTED");
  assert.equal(typeof rejected[0].auditId, "string");

  const active = await callAsStaff(database, actorId, activeListingId, "APPROVE", "Reviewed");
  assert.equal(active[0].applied, true);
  assert.equal(active[0].status, "ACTIVE");
  assert.equal(typeof active[0].auditId, "string");
  const soldOut = await callAsStaff(database, actorId, soldOutListingId, "APPROVE");
  assert.equal(soldOut[0].applied, true);
  assert.equal(soldOut[0].status, "SOLD_OUT");
  assert.equal(typeof soldOut[0].auditId, "string");

  const replay = await callAsStaff(database, actorId, activeListingId, "APPROVE");
  assert.equal(replay[0].applied, false);
  assert.equal(replay[0].auditId, null);
  assert.equal(replay[0].status, "ACTIVE");
  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = true, "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  const staleUnavailable = await callAsStaff(database, actorId, activeListingId, "APPROVE");
  assert.equal(staleUnavailable[0].applied, false);
  assert.equal(staleUnavailable[0].blockReason, "SELLER_VACATION");
  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = false, "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  assert.deepEqual(
    await callAsStaff(database, actorId, `${activeListingId}_missing`, "APPROVE"),
    [],
  );

  assert.deepEqual(rowsOf(await database.query(
    `SELECT id, status::text AS status, "reviewedByAdmin", "rejectionReason"
       FROM public."Listing"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [listingIds],
  )), [
    { id: activeListingId, status: "ACTIVE", reviewedByAdmin: true, rejectionReason: null },
    { id: rejectedListingId, status: "REJECTED", reviewedByAdmin: true, rejectionReason: "Listing needs changes" },
    { id: soldOutListingId, status: "SOLD_OUT", reviewedByAdmin: true, rejectionReason: null },
  ].sort((left, right) => left.id.localeCompare(right.id)));
  assert.deepEqual(rowsOf(await database.query(
    `SELECT action, "targetId", reason, metadata
       FROM public."AdminAuditLog"
      WHERE id = ANY($1::text[])
      ORDER BY "targetId"`,
    [[rejected[0].auditId, active[0].auditId, soldOut[0].auditId]],
  )), [
    { action: "APPROVE_LISTING", targetId: activeListingId, reason: "Reviewed", metadata: { finalStatus: "ACTIVE" } },
    { action: "REJECT_LISTING", targetId: rejectedListingId, reason: "Listing needs changes", metadata: {} },
    { action: "APPROVE_LISTING", targetId: soldOutListingId, reason: "Approved", metadata: { finalStatus: "SOLD_OUT" } },
  ].sort((left, right) => left.targetId.localeCompare(right.targetId)));

  await database.query(`UPDATE public."User" SET banned = true WHERE id = $1`, [actorId]);
  await assert.rejects(
    callAsStaff(database, actorId, activeListingId, "APPROVE"),
    (error) => error?.code === "42501",
  );
  await database.query(`UPDATE public."User" SET banned = false WHERE id = $1`, [actorId]);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_listing_review_transition($1, $2, 'APPROVE', '')`,
        [actorId, activeListingId],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `DELETE FROM public."AdminAuditLog" WHERE "targetId" = ANY($1::text[])`,
    [listingIds],
  );
  await database.query(`DELETE FROM public."Listing" WHERE id = ANY($1::text[])`, [listingIds]);
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [actorId]);
}
