import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function runtimeQuery(database, actorId, sql, params = []) {
  await database.query("BEGIN");
  try {
    await database.query("SET LOCAL ROLE grainline_app_runtime");
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [actorId ?? ""],
    );
    const result = await database.query(sql, params);
    await database.query("COMMIT");
    return result;
  } catch (error) {
    await database.query("ROLLBACK").catch(() => {});
    throw error;
  }
}

const REVIEW_CONTEXT_SQL = `
  SELECT *
    FROM public.grainline_listing_actor_review_contexts($1::text[])
`;

const CUSTOMER_PHOTO_SQL = `
  SELECT *
    FROM public.grainline_listing_public_customer_photo_page(
      $1::text, $2::integer, $3::integer
    )
`;

export async function proveListingDomainReviewHistory({ database }) {
  const suffix = randomUUID();
  const historySellerUser = `listing-history-seller-user-${suffix}`;
  const historySellerProfile = `listing-history-seller-${suffix}`;
  const buyerA = `listing-history-buyer-a-${suffix}`;
  const buyerB = `listing-history-buyer-b-${suffix}`;
  const viewer = `listing-history-viewer-${suffix}`;
  const stranger = `listing-history-stranger-${suffix}`;
  const activeListing = `listing-history-active-${suffix}`;
  const soldOutListing = `listing-history-sold-${suffix}`;
  const privateListing = `listing-history-private-${suffix}`;
  const activeReview = `listing-history-review-active-${suffix}`;
  const soldOutReview = `listing-history-review-sold-${suffix}`;
  const privateReview = `listing-history-review-private-${suffix}`;
  const now = "2026-11-02 15:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.proname AS name,
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
     WHERE routine.oid IN (
       pg_catalog.to_regprocedure(
         'public.grainline_listing_actor_review_contexts(text[])'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_listing_public_customer_photo_page(text,integer,integer)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_listing_actor_review_contexts",
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_listing_public_customer_photo_page",
      runtimeExecute: true,
      publicExecute: false,
    },
  ]);

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $5, $9, 'History buyer A', $13, $13, $13, '2026-01-01', $13),
       ($2, $6, $10, 'History buyer B', $13, $13, $13, '2026-01-01', $13),
       ($3, $7, $11, 'History viewer', $13, $13, $13, '2026-01-01', $13),
       ($4, $8, $12, 'History stranger', $13, $13, $13, '2026-01-01', $13)`,
    [
      buyerA,
      buyerB,
      viewer,
      stranger,
      `clerk_${buyerA}`,
      `clerk_${buyerB}`,
      `clerk_${viewer}`,
      `clerk_${stranger}`,
      `${buyerA}@example.test`,
      `${buyerB}@example.test`,
      `${viewer}@example.test`,
      `${stranger}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'History proof seller', $4, $4, $4, '2026-01-01', $4)`,
    [
      historySellerUser,
      `clerk_${historySellerUser}`,
      `${historySellerUser}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
       (id, "userId", "displayName", "displayNameNormalized", city, state,
        "chargesEnabled", "stripeAccountSupported", "ownerAccountActive",
        "vacationMode", "createdAt", "updatedAt")
     VALUES ($1, $2, 'History proof maker', $3, 'Austin', 'TX',
             true, true, true, false, $4, $4)`,
    [historySellerProfile, historySellerUser, historySellerProfile.toLowerCase(), now],
  );

  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt")
     VALUES
       ($1, $4, 'Active retained review', 'Active', 1000, 'usd', 'ACTIVE',
        'IN_STOCK', 2, false, $5, $5),
       ($2, $4, 'Sold out retained review', 'Sold out', 1100, 'usd', 'SOLD_OUT',
        'IN_STOCK', 0, false, $5, $5),
       ($3, $4, 'Private retained review', 'Private', 1200, 'usd', 'ACTIVE',
        'MADE_TO_ORDER', NULL, true, $5, $5)`,
    [activeListing, soldOutListing, privateListing, historySellerProfile, now],
  );
  await database.query(
    `UPDATE public."Listing"
        SET "sellerPubliclyOrderable" = true
      WHERE id = ANY($1::text[])`,
    [[activeListing, soldOutListing, privateListing]],
  );

  await database.query(
    `INSERT INTO public."Photo"
       (id, "listingId", url, "originalUrl", "altText", "sortOrder", "createdAt")
     VALUES ($1, $2, $3, $3, 'Retained listing photo', 0, $4)`,
    [
      `listing-history-listing-photo-${suffix}`,
      privateListing,
      "https://example.test/retained-listing.jpg",
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Review"
       (id, "listingId", "reviewerId", "reviewerAccountActive", "ratingX2",
        comment, "sellerReply", "sellerReplyAt", "createdAt", "updatedAt")
     VALUES
       ($1, $4, $7, true, 10, 'Active review', 'Thanks A', $9, $9, $9),
       ($2, $5, $8, true, 8, 'Sold out review', 'Thanks B', $9, $9, $9),
       ($3, $6, $7, true, 6, 'Private review', 'Thanks private', $9, $9, $9)`,
    [
      activeReview,
      soldOutReview,
      privateReview,
      activeListing,
      soldOutListing,
      privateListing,
      buyerA,
      buyerB,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."ReviewPhoto"
       (id, "reviewId", url, "altText", "sortOrder", "createdAt")
     VALUES
       ($1, $4, 'https://example.test/review-active.jpg', 'Active photo', 0, $7),
       ($2, $5, 'https://example.test/review-sold.jpg', 'Sold photo', 0, $7),
       ($3, $6, 'https://example.test/review-private.jpg', 'Private photo', 0, $7)`,
    [
      `listing-history-review-photo-active-${suffix}`,
      `listing-history-review-photo-sold-${suffix}`,
      `listing-history-review-photo-private-${suffix}`,
      activeReview,
      soldOutReview,
      privateReview,
      now,
    ],
  );

  const requestedReviews = [privateReview, soldOutReview, activeReview];
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerA,
    REVIEW_CONTEXT_SQL,
    [requestedReviews],
  )), [
    {
      reviewId: privateReview,
      listingId: privateListing,
      listingTitle: "Private retained review",
      sellerProfileId: historySellerProfile,
      listingPhotoUrl: "https://example.test/retained-listing.jpg",
    },
    {
      reviewId: activeReview,
      listingId: activeListing,
      listingTitle: "Active retained review",
      sellerProfileId: historySellerProfile,
      listingPhotoUrl: null,
    },
  ], "reviewers must retain their own hidden Listing history only");
  assert.equal(rowsOf(await runtimeQuery(
    database,
    historySellerUser,
    REVIEW_CONTEXT_SQL,
    [requestedReviews],
  )).length, 3, "the maker must retain every review on their Listings");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    stranger,
    REVIEW_CONTEXT_SQL,
    [requestedReviews],
  )), [], "unrelated actors must receive no retained review context");

  const publicPage = rowsOf(await runtimeQuery(
    database,
    null,
    CUSTOMER_PHOTO_SQL,
    [historySellerProfile, 0, 10],
  ));
  assert.equal(Number(publicPage[0]?.totalCount), 2);
  assert.deepEqual(
    publicPage[0]?.photos.map((photo) => photo.listingId).sort(),
    [activeListing, soldOutListing].sort(),
    "public customer photos must include SOLD_OUT but exclude private Listings",
  );

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [`listing-history-block-${suffix}`, viewer, buyerA, now],
  );
  const blockedPage = rowsOf(await runtimeQuery(
    database,
    viewer,
    CUSTOMER_PHOTO_SQL,
    [historySellerProfile, 0, 10],
  ));
  assert.equal(Number(blockedPage[0]?.totalCount), 1);
  assert.deepEqual(
    blockedPage[0]?.photos.map((photo) => photo.listingId),
    [soldOutListing],
    "customer-photo pages must filter reciprocal reviewer blocks",
  );

  await assert.rejects(
    runtimeQuery(database, null, REVIEW_CONTEXT_SQL, [[activeReview]]),
    (error) => error?.code === "22023",
    "retained review history must require an actor",
  );
}
