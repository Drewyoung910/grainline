import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileAccountDeletionMediaAuthority({ database, seller }) {
  const sideEffectId = `${seller.userId}_media_effect`;
  const listingId = `${seller.sellerProfileId}_media_listing`;
  const photoId = `${seller.sellerProfileId}_media_photo`;
  const claimToken = "11111111-1111-4111-8111-111111111115";
  const now = new Date("2026-10-19T19:00:00.000Z");
  const expectedUrls = [
    "https://example.test/account-avatar.jpg",
    "https://example.test/account-banner.jpg",
    "https://example.test/account-gallery.jpg",
    "https://example.test/account-listing-original.jpg",
    "https://example.test/account-listing-photo.jpg",
    "https://example.test/account-listing-video.mp4",
    "https://example.test/account-workshop.jpg",
  ];
  const profileBefore = rowsOf(await database.query(
    `SELECT "avatarImageUrl", "bannerImageUrl", "workshopImageUrl", "galleryImageUrls"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ))[0];
  assert.ok(profileBefore, "seller profile must exist for deletion media proof");
  const existingMediaUrls = rowsOf(await database.query(
    `SELECT media.url
       FROM (
         SELECT listing."videoUrl"::text AS url
           FROM public."Listing" AS listing
          WHERE listing."sellerId" = $1
         UNION
         SELECT photo.url::text
           FROM public."Listing" AS listing
           JOIN public."Photo" AS photo ON photo."listingId" = listing.id
          WHERE listing."sellerId" = $1
         UNION
         SELECT photo."originalUrl"::text
           FROM public."Listing" AS listing
           JOIN public."Photo" AS photo ON photo."listingId" = listing.id
          WHERE listing."sellerId" = $1
       ) AS media
      WHERE media.url IS NOT NULL
        AND pg_catalog.btrim(media.url) <> ''`,
    [seller.sellerProfileId],
  )).map((row) => row.url);
  const allExpectedUrls = [...new Set([...existingMediaUrls, ...expectedUrls])].sort();

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
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_seller_account_deletion_public_media_urls(text,bigint,uuid)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "v",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    staffExecute: false,
    publicExecute: false,
  }]);

  await database.query(
    `UPDATE public."SellerProfile"
        SET "avatarImageUrl" = $2,
            "bannerImageUrl" = $3,
            "workshopImageUrl" = $4,
            "galleryImageUrls" = ARRAY[$5]::text[],
            "updatedAt" = $6
      WHERE id = $1`,
    [
      seller.sellerProfileId,
      expectedUrls[0],
      expectedUrls[1],
      expectedUrls[6],
      expectedUrls[2],
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", status, "videoUrl",
       "isPrivate", "qualityScore", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Deletion media listing', 'Deletion media proof', 1200,
             'HIDDEN', $3, true, 0, $4, $4)`,
    [listingId, seller.sellerProfileId, expectedUrls[5], now],
  );
  await database.query(
    `INSERT INTO public."Photo"
      (id, "listingId", url, "originalUrl", "sortOrder", "createdAt")
     VALUES ($1, $2, $3, $4, 0, $5)`,
    [photoId, listingId, expectedUrls[4], expectedUrls[3], now],
  );
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect"
      (id, "userId", kind, "dedupKey", payload, status, attempts,
       "claimGeneration", "claimToken", "processingStartedAt",
       "createdAt", "updatedAt")
     VALUES ($1, $2, 'LOCAL_ANONYMIZE', $3, '{}'::jsonb, 'PROCESSING', 1,
             1, $4::uuid, $5, $5, $5)`,
    [sideEffectId, seller.userId, `account-delete:local:${seller.userId}`, claimToken, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT url
         FROM public.grainline_seller_account_deletion_public_media_urls(
           $1, 1, $2::uuid
         )
        ORDER BY url ASC`,
      [sideEffectId, claimToken],
    )).map((row) => row.url), allExpectedUrls);

    await assert.rejects(
      database.query(
        `SELECT url
           FROM public.grainline_seller_account_deletion_public_media_urls(
             $1, 2, $2::uuid
           )`,
        [sideEffectId, claimToken],
      ),
      /claim is not authorized/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SET ROLE grainline_staff_read_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT url
           FROM public.grainline_seller_account_deletion_public_media_urls(
             $1, 1, $2::uuid
           )`,
        [sideEffectId, claimToken],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(`DELETE FROM public."AccountDeletionSideEffect" WHERE id = $1`, [sideEffectId]);
  await database.query(`DELETE FROM public."Photo" WHERE id = $1`, [photoId]);
  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [listingId]);
  await database.query(
    `UPDATE public."SellerProfile"
        SET "avatarImageUrl" = $2,
            "bannerImageUrl" = $3,
            "workshopImageUrl" = $4,
            "galleryImageUrls" = $5::text[],
            "updatedAt" = $6
      WHERE id = $1`,
    [
      seller.sellerProfileId,
      profileBefore.avatarImageUrl,
      profileBefore.bannerImageUrl,
      profileBefore.workshopImageUrl,
      profileBefore.galleryImageUrls,
      now,
    ],
  );
}
