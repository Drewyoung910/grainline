import assert from "node:assert/strict";

export const LISTING_SHIPPING_READINESS_MIGRATION =
  "20261027060000_enforce_listing_shipping_readiness";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function callOnboardingComplete(database, seller) {
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [seller.userId],
    );
    return rowsOf(await database.query(
      `SELECT public.grainline_seller_owner_onboarding_complete($1, $2) AS completed`,
      [seller.userId, seller.sellerProfileId],
    ));
  } finally {
    await database.query("SELECT pg_catalog.set_config('app.user_id', '', false)");
    await database.query("RESET ROLE");
  }
}

async function callStaffReview(database, actorId, listingId) {
  await database.query("SET SESSION AUTHORIZATION grainline_staff_read_runtime");
  try {
    return rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_staff_listing_review_transition(
           $1, $2, 'APPROVE', 'C-264 proof'
         )`,
      [actorId, listingId],
    ));
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

export async function seedListingShippingReadinessPredecessorGap({
  database,
  seller,
}) {
  const actorId = `${seller.userId}_shipping_admin`;
  const listingId = `${seller.sellerProfileId}_shipping_gap`;
  const now = "2026-10-27 12:00:00";

  const [sellerBefore] = rowsOf(await database.query(
    `SELECT "ownerAccountActive", "chargesEnabled", "vacationMode",
            "shippingFlatRateCents", "allowLocalPickup", "updatedAt"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ));
  const [sellerPrivateBefore] = rowsOf(await database.query(
    `SELECT "shipFromLine1", "shipFromCity", "shipFromState",
            "shipFromPostal", "defaultPkgWeightGrams", "defaultPkgLengthCm",
            "defaultPkgWidthCm", "defaultPkgHeightCm", "onboardingStep",
            "onboardingComplete", "updatedAt"
       FROM public."SellerProfilePrivate"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ));
  assert.ok(sellerBefore, "seller fixture must exist before C-264 predecessor proof");
  assert.ok(
    sellerPrivateBefore,
    "seller-private fixture must exist before C-264 predecessor proof",
  );

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Shipping readiness admin', 'ADMIN',
             $4, $4, $4, '2026-01-01', $4)`,
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
            "shippingFlatRateCents" = NULL,
            "allowLocalPickup" = false,
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "shipFromLine1" = NULL,
            "shipFromCity" = NULL,
            "shipFromState" = NULL,
            "shipFromPostal" = NULL,
            "defaultPkgWeightGrams" = NULL,
            "defaultPkgLengthCm" = NULL,
            "defaultPkgWidthCm" = NULL,
            "defaultPkgHeightCm" = NULL,
            "onboardingStep" = 5,
            "onboardingComplete" = false,
            "updatedAt" = $2
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Unshippable predecessor listing',
             'C-264 predecessor proof', 4500, 'usd', 'PENDING_REVIEW',
             'IN_STOCK', 1, false, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );

  assert.deepEqual(await callOnboardingComplete(database, seller), [{ completed: true }]);
  const predecessorApproval = await callStaffReview(database, actorId, listingId);
  assert.equal(predecessorApproval.length, 1);
  assert.equal(predecessorApproval[0].applied, true);
  assert.equal(predecessorApproval[0].status, "ACTIVE");

  await database.query(
    `UPDATE public."SellerProfile"
        SET "ownerAccountActive" = $2,
            "chargesEnabled" = $3,
            "vacationMode" = $4,
            "shippingFlatRateCents" = $5,
            "allowLocalPickup" = $6,
            "updatedAt" = $7
      WHERE id = $1`,
    [
      seller.sellerProfileId,
      sellerBefore.ownerAccountActive,
      sellerBefore.chargesEnabled,
      sellerBefore.vacationMode,
      sellerBefore.shippingFlatRateCents,
      sellerBefore.allowLocalPickup,
      sellerBefore.updatedAt,
    ],
  );
  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "shipFromLine1" = $2,
            "shipFromCity" = $3,
            "shipFromState" = $4,
            "shipFromPostal" = $5,
            "defaultPkgWeightGrams" = $6,
            "defaultPkgLengthCm" = $7,
            "defaultPkgWidthCm" = $8,
            "defaultPkgHeightCm" = $9,
            "onboardingStep" = $10,
            "onboardingComplete" = $11,
            "updatedAt" = $12
      WHERE "sellerProfileId" = $1`,
    [
      seller.sellerProfileId,
      sellerPrivateBefore.shipFromLine1,
      sellerPrivateBefore.shipFromCity,
      sellerPrivateBefore.shipFromState,
      sellerPrivateBefore.shipFromPostal,
      sellerPrivateBefore.defaultPkgWeightGrams,
      sellerPrivateBefore.defaultPkgLengthCm,
      sellerPrivateBefore.defaultPkgWidthCm,
      sellerPrivateBefore.defaultPkgHeightCm,
      sellerPrivateBefore.onboardingStep,
      sellerPrivateBefore.onboardingComplete,
      sellerPrivateBefore.updatedAt,
    ],
  );
  await database.query(
    `UPDATE public."Listing"
        SET status = 'PENDING_REVIEW',
            "reviewedByAdmin" = false,
            "reviewedAt" = NULL
      WHERE id = $1`,
    [listingId],
  );
  await database.query(
    `DELETE FROM public."AdminAuditLog" WHERE "targetId" = $1`,
    [listingId],
  );

  return Object.freeze({ actorId, listingId });
}

export async function proveListingShippingReadinessCorrection({
  database,
  seller,
  fixture,
}) {
  await database.query(
    `UPDATE public."SellerProfile"
        SET "ownerAccountActive" = true,
            "chargesEnabled" = true,
            "vacationMode" = false,
            "shippingFlatRateCents" = NULL,
            "allowLocalPickup" = false
      WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `UPDATE public."SellerProfilePrivate"
        SET "shipFromLine1" = NULL,
            "shipFromCity" = NULL,
            "shipFromState" = NULL,
            "shipFromPostal" = NULL,
            "defaultPkgWeightGrams" = NULL,
            "defaultPkgLengthCm" = NULL,
            "defaultPkgWidthCm" = NULL,
            "defaultPkgHeightCm" = NULL,
            "onboardingStep" = 5,
            "onboardingComplete" = false
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `UPDATE public."Listing"
        SET status = 'PENDING_REVIEW',
            "reviewedByAdmin" = false,
            "reviewedAt" = NULL
      WHERE id = $1`,
    [fixture.listingId],
  );

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
           ) AS "staffExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
               ) AS acl
              WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_listing_shipping_ready(integer,boolean,text,text,text,text,text,integer,double precision,double precision,double precision,integer,double precision,double precision,double precision)'
     )
  `)), [{
    securityDefiner: false,
    volatility: "i",
    config: ["search_path=pg_catalog"],
    runtimeExecute: false,
    staffExecute: false,
    publicExecute: false,
  }]);

  assert.deepEqual(await callOnboardingComplete(database, seller), [{ completed: false }]);
  const blockedApproval = await callStaffReview(
    database,
    fixture.actorId,
    fixture.listingId,
  );
  assert.equal(blockedApproval.length, 1);
  assert.equal(blockedApproval[0].applied, false);
  assert.equal(blockedApproval[0].blockReason, "SELLER_SHIPPING_UNAVAILABLE");
  assert.equal(blockedApproval[0].status, "PENDING_REVIEW");

  await database.query(
    `UPDATE public."SellerProfile"
        SET "allowLocalPickup" = true
      WHERE id = $1`,
    [seller.sellerProfileId],
  );
  assert.deepEqual(await callOnboardingComplete(database, seller), [{ completed: true }]);
  const approved = await callStaffReview(database, fixture.actorId, fixture.listingId);
  assert.equal(approved.length, 1);
  assert.equal(approved[0].applied, true);
  assert.equal(approved[0].status, "ACTIVE");

  await database.query(
    `DELETE FROM public."AdminAuditLog" WHERE "targetId" = $1`,
    [fixture.listingId],
  );
  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [fixture.listingId]);
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [fixture.actorId]);
}
