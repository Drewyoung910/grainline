import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileFoundingMakerGrant({ database, seller }) {
  const now = new Date();
  const userId = `${seller.userId}_founding_grant`;
  const sellerProfileId = `${seller.sellerProfileId}_founding_grant`;
  const listingId = `${seller.sellerProfileId}_founding_listing`;

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Founding Grant Seller', $4, $4, $4, '2026-01-01', $4)`,
    [
      userId,
      `user_full_chain_founding_${seller.userId}`.slice(0, 255),
      `founding-${seller.userId}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
      (id, "userId", "displayName", "displayNameNormalized",
       "chargesEnabled", "stripeAccountSupported", "vacationMode",
       "ownerAccountActive", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full Chain Founding Seller', 'full chain founding seller',
             true, true, false, true, $3, $3)`,
    [sellerProfileId, userId, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", status,
       "isPrivate", "qualityScore", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Founding Grant Listing', 'Founding grant full-chain proof',
             1500, 'ACTIVE', false, 1.0, $3, $3)`,
    [listingId, sellerProfileId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT public.grainline_seller_service_founding_maker_grant($1) AS granted`,
        [sellerProfileId],
      )),
      [{ granted: true }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT public.grainline_seller_service_founding_maker_grant($1) AS granted`,
        [sellerProfileId],
      )),
      [{ granted: true }],
    );
  } finally {
    await database.query("RESET ROLE");
  }

  const result = rowsOf(await database.query(
    `SELECT seller."isFoundingMaker",
            seller."foundingMakerNumber",
            grant_row."foundingMakerNumber" AS "ledgerNumber",
            COUNT(*) OVER () AS "rowCount"
       FROM public."SellerProfile" AS seller
       JOIN public."FoundingMakerGrant" AS grant_row
         ON grant_row."sellerProfileId" = seller.id
      WHERE seller.id = $1`,
    [sellerProfileId],
  ));
  assert.equal(result.length, 1);
  assert.equal(result[0].isFoundingMaker, true);
  assert.equal(Number.isSafeInteger(result[0].foundingMakerNumber), true);
  assert.equal(result[0].ledgerNumber, result[0].foundingMakerNumber);
  assert.equal(Number(result[0].rowCount), 1);

  await database.query("SET ROLE grainline_staff_read_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT public.grainline_seller_service_founding_maker_grant($1)`,
        [sellerProfileId],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }
}
