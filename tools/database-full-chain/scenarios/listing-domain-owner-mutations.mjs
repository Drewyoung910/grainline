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

const CREATE_SQL = `
  SELECT *
    FROM public.grainline_listing_owner_create(
      $1::text, $2::text, $3::boolean, $4::text, $5::text,
      $6::text, $7::text, $8::integer, $9::text[], $10::text,
      $11::text[], $12::double precision, $13::double precision,
      $14::double precision, $15::double precision, $16::double precision,
      $17::double precision, $18::integer, $19::text, $20::text,
      $21::integer, $22::integer, $23::integer, $24::integer,
      $25::jsonb, $26::jsonb
    )
`;

const UPDATE_SQL = `
  SELECT *
    FROM public.grainline_listing_owner_content_update(
      $1::text, $2::timestamp without time zone, $3::text, $4::text,
      $5::text, $6::text, $7::integer, $8::boolean, $9::text[],
      $10::text, $11::text[], $12::double precision,
      $13::double precision, $14::double precision, $15::double precision,
      $16::double precision, $17::double precision, $18::integer,
      $19::text, $20::text, $21::integer, $22::integer,
      $23::integer, $24::integer, $25::jsonb, $26::jsonb
    )
`;

const ALT_TEXT_BACKFILL_SQL = `
  SELECT public.grainline_listing_owner_alt_text_backfill(
    $1::text, $2::text[], $3::text[]
  ) AS updated_count
`;

const AI_REVIEW_CONTEXT_SQL = `
  SELECT *
    FROM public.grainline_listing_owner_ai_review_context($1::text)
`;

const LISTING_TRANSACTION_SOURCE_SQL = `
  SELECT *
    FROM public.grainline_listing_actor_transaction_source($1::text)
`;

const LISTING_CART_TRANSACTION_SOURCES_SQL = `
  SELECT *
    FROM public.grainline_listing_actor_cart_transaction_sources($1::text)
`;

const LEGACY_STOCK_RESTORE_SQL = `
  SELECT claimed, stock_visibility_changed
    FROM public.grainline_legacy_stock_restore_apply(
      $1::text, $2::jsonb
    )
`;

const LISTING_ACCOUNT_DELETION_SQL = `
  SELECT *
    FROM public.grainline_listing_account_deletion_redact(
      $1::text, $2::text, $3::bigint, $4::uuid,
      $5::timestamp without time zone
    )
`;

const LISTING_OWNER_RATING_BUCKETS_SQL = `
  SELECT *
    FROM public.grainline_listing_owner_rating_buckets(
      $1::bigint, $2::bigint, $3::boolean
    )
`;

const LISTING_SELLER_RATING_SUMMARY_REFRESH_SQL = `
  SELECT *
    FROM public.grainline_listing_seller_rating_summary_refresh($1::text)
`;

function createArgs({
  listingId,
  status = "DRAFT",
  isPrivate = false,
  reservedForUserId = null,
  conversationId = null,
  title = "Full-chain listing authority proof",
  photos,
  variantGroups = [],
  listingType = "MADE_TO_ORDER",
  stockQuantity = null,
}) {
  return [
    listingId,
    status,
    isPrivate,
    reservedForUserId,
    conversationId,
    title,
    "Full-chain owner-create and atomic child replacement proof.",
    25_000,
    ["full-chain", "authority"],
    "Owner-create proof listing",
    ["walnut"],
    10,
    20,
    30,
    25.4,
    50.8,
    76.2,
    1_000,
    "FURNITURE",
    listingType,
    stockQuantity,
    listingType === "IN_STOCK" ? 7 : null,
    listingType === "IN_STOCK" ? null : 7,
    listingType === "IN_STOCK" ? null : 14,
    JSON.stringify(photos),
    JSON.stringify(variantGroups),
  ];
}

function updateArgs({ listingId, listing, title, photos, variantGroups }) {
  return [
    listingId,
    listing.updatedAt,
    listing.status,
    listing.listingType,
    title,
    "Atomic parent and child replacement proof.",
    26_000,
    true,
    ["full-chain", "updated"],
    "Updated owner-mutation proof",
    ["walnut", "oak"],
    11,
    21,
    31,
    26.4,
    51.8,
    77.2,
    1_100,
    "FURNITURE",
    "MADE_TO_ORDER",
    null,
    null,
    8,
    15,
    JSON.stringify(photos),
    JSON.stringify(variantGroups),
  ];
}

export async function proveListingDomainOwnerMutations({ database, seller }) {
  const suffix = randomUUID();
  const listingId = `listing-owner-proof-${suffix}`;
  const buyerId = `listing-buyer-proof-${suffix}`;
  const conversationId = randomUUID();
  const initialPhotoId = `listing-photo-initial-${suffix}`;
  const removedPhotoId = `listing-photo-removed-${suffix}`;
  const replacementPhotoId = `listing-photo-replacement-${suffix}`;
  const initialGroupId = `listing-group-initial-${suffix}`;
  const initialOptionId = `listing-option-initial-${suffix}`;
  const replacementGroupId = `listing-group-replacement-${suffix}`;
  const replacementOptionId = `listing-option-replacement-${suffix}`;

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES (
       $1, $2, $3, 'Listing proof buyer',
       pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp(),
       pg_catalog.clock_timestamp(), '2026-01-01', pg_catalog.clock_timestamp()
     )`,
    [buyerId, `clerk_${buyerId}`, `${buyerId}@example.test`],
  );
  const createResult = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    CREATE_SQL,
    createArgs({
      listingId,
      photos: [
        {
          id: initialPhotoId,
          url: "https://example.test/listing-initial.jpg",
          originalUrl: "https://example.test/listing-initial.jpg",
          altText: "Initial front view",
          sortOrder: 0,
        },
        {
          id: removedPhotoId,
          url: "https://example.test/listing-removed.jpg",
          originalUrl: "https://example.test/listing-removed.jpg",
          altText: null,
          sortOrder: 1,
        },
      ],
      variantGroups: [{
        id: initialGroupId,
        name: "Finish",
        sortOrder: 0,
        options: [{
          id: initialOptionId,
          label: "Natural",
          priceAdjustCents: 0,
          sortOrder: 0,
          inStock: true,
        }],
      }],
    }),
  ));
  assert.equal(createResult.length, 1);
  assert.equal(createResult[0]?.created, true);
  assert.equal(createResult[0]?.id, listingId);

  let [listing] = rowsOf(await database.query(
    `SELECT id, title, status::text AS status,
            "listingType"::text AS "listingType", "updatedAt"
       FROM public."Listing"
      WHERE id = $1`,
    [listingId],
  ));
  assert.ok(listing);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT id, "sortOrder" AS "sortOrder"
       FROM public."Photo"
      WHERE "listingId" = $1
      ORDER BY "sortOrder"`,
    [listingId],
  )), [
    { id: initialPhotoId, sortOrder: 0 },
    { id: removedPhotoId, sortOrder: 1 },
  ]);

  const replacementPhotos = [
    {
      id: initialPhotoId,
      url: "https://example.test/listing-initial-cropped.jpg",
      originalUrl: "https://example.test/listing-initial.jpg",
      altText: "Updated front view",
      sortOrder: 0,
    },
    {
      id: replacementPhotoId,
      url: "https://example.test/listing-replacement.jpg",
      originalUrl: "https://example.test/listing-replacement.jpg",
      altText: null,
      sortOrder: 1,
    },
  ];
  const replacementGroups = [{
    id: replacementGroupId,
    name: "Wood",
    sortOrder: 0,
    options: [{
      id: replacementOptionId,
      label: "Walnut",
      priceAdjustCents: 1_000,
      sortOrder: 0,
      inStock: true,
    }],
  }];
  const updateResult = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    UPDATE_SQL,
    updateArgs({
      listingId,
      listing,
      title: "Updated full-chain listing authority proof",
      photos: replacementPhotos,
      variantGroups: replacementGroups,
    }),
  ));
  assert.equal(updateResult.length, 1);
  assert.equal(updateResult[0]?.applied, true);

  [listing] = rowsOf(await database.query(
    `SELECT id, title, status::text AS status,
            "listingType"::text AS "listingType", "updatedAt"
       FROM public."Listing"
      WHERE id = $1`,
    [listingId],
  ));
  assert.equal(listing.title, "Updated full-chain listing authority proof");
  assert.deepEqual(rowsOf(await database.query(
    `SELECT id, url, "sortOrder" AS "sortOrder"
       FROM public."Photo"
      WHERE "listingId" = $1
      ORDER BY "sortOrder"`,
    [listingId],
  )), [
    {
      id: initialPhotoId,
      url: "https://example.test/listing-initial-cropped.jpg",
      sortOrder: 0,
    },
    {
      id: replacementPhotoId,
      url: "https://example.test/listing-replacement.jpg",
      sortOrder: 1,
    },
  ]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT variant_group.id AS "groupId",
            variant_option.id AS "optionId"
       FROM public."ListingVariantGroup" AS variant_group
       JOIN public."ListingVariantOption" AS variant_option
         ON variant_option."groupId" = variant_group.id
      WHERE variant_group."listingId" = $1`,
    [listingId],
  )), [{ groupId: replacementGroupId, optionId: replacementOptionId }]);

  const aiReviewContext = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    AI_REVIEW_CONTEXT_SQL,
    [listingId],
  ));
  assert.equal(aiReviewContext.length, 1);
  assert.equal(aiReviewContext[0]?.sellerProfileId, seller.sellerProfileId);
  assert.equal(
    aiReviewContext[0]?.listingUpdatedAt?.getTime(),
    listing.updatedAt.getTime(),
  );
  assert.deepEqual(aiReviewContext[0]?.photoUrls, replacementPhotos.map((photo) => photo.url));
  assert.equal(Array.isArray(aiReviewContext[0]?.recentTitles), true);
  assert.equal(
    aiReviewContext[0]?.recentTitles.includes("Updated full-chain listing authority proof"),
    false,
    "AI-review duplicate titles must exclude the listing under review",
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    AI_REVIEW_CONTEXT_SQL,
    [listingId],
  )), [], "AI-review context must reject a cross-owner actor");

  const exactBackfill = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    ALT_TEXT_BACKFILL_SQL,
    [
      listingId,
      ["AI must not replace seller text", "AI-generated replacement side view"],
      replacementPhotos.map((photo) => photo.url),
    ],
  ));
  assert.equal(exactBackfill[0]?.updated_count, 1);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "altText" AS "altText"
       FROM public."Photo"
      WHERE "listingId" = $1
      ORDER BY "sortOrder", id`,
    [listingId],
  )), [
    { altText: "Updated front view" },
    { altText: "AI-generated replacement side view" },
  ], "AI backfill must preserve seller-provided alt text");

  const staleBackfill = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    ALT_TEXT_BACKFILL_SQL,
    [
      listingId,
      ["stale first", "stale second"],
      [replacementPhotos[0].url, "https://example.test/stale-photo.jpg"],
    ],
  ));
  assert.equal(
    staleBackfill[0]?.updated_count,
    0,
    "AI backfill must reject a stale reviewed image sequence",
  );

  const crossOwnerBackfill = rowsOf(await runtimeQuery(
    database,
    buyerId,
    ALT_TEXT_BACKFILL_SQL,
    [
      listingId,
      ["cross-owner first", "cross-owner second"],
      replacementPhotos.map((photo) => photo.url),
    ],
  ));
  assert.equal(
    crossOwnerBackfill[0]?.updated_count,
    0,
    "AI backfill must reject a cross-owner actor",
  );

  const transactionListingId = `listing-transaction-source-proof-${suffix}`;
  const transactionPhotoId = `listing-transaction-source-photo-${suffix}`;
  const transactionGroupId = `listing-transaction-source-group-${suffix}`;
  const transactionOptionId = `listing-transaction-source-option-${suffix}`;
  const transactionCreate = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    CREATE_SQL,
    createArgs({
      listingId: transactionListingId,
      title: "Actor-bound transaction source proof",
      listingType: "IN_STOCK",
      stockQuantity: 2,
      photos: [{
        id: transactionPhotoId,
        url: "https://example.test/transaction-source.jpg",
        originalUrl: "https://example.test/transaction-source-original.jpg",
        altText: "Transaction source proof",
        sortOrder: 0,
      }],
      variantGroups: [{
        id: transactionGroupId,
        name: "Finish",
        sortOrder: 0,
        options: [{
          id: transactionOptionId,
          label: "Natural",
          priceAdjustCents: 500,
          sortOrder: 0,
          inStock: true,
        }],
      }],
    }),
  ));
  assert.equal(transactionCreate[0]?.created, true);
  await database.query(
    `UPDATE public."Listing"
        SET status = 'ACTIVE'
      WHERE id = $1`,
    [transactionListingId],
  );
  const ratingPrivilege = rowsOf(await database.query(
    `SELECT
       pg_catalog.has_function_privilege(
         'grainline_app_runtime',
         'public.grainline_listing_owner_rating_buckets(bigint,bigint,boolean)',
         'EXECUTE'
       ) AS runtime_execute,
       pg_catalog.has_function_privilege(
         'grainline_staff_read_runtime',
         'public.grainline_listing_owner_rating_buckets(bigint,bigint,boolean)',
         'EXECUTE'
       ) AS staff_execute,
       pg_catalog.has_function_privilege(
         'public',
         'public.grainline_listing_owner_rating_buckets(bigint,bigint,boolean)',
         'EXECUTE'
       ) AS public_execute`,
  ))[0];
  assert.deepEqual(ratingPrivilege, {
    runtime_execute: true,
    staff_execute: false,
    public_execute: false,
  });
  const ratingRefreshPrivilege = rowsOf(await database.query(
    `SELECT
       pg_catalog.has_function_privilege(
         'grainline_app_runtime',
         'public.grainline_listing_seller_rating_summary_refresh(text)',
         'EXECUTE'
       ) AS runtime_execute,
       pg_catalog.has_function_privilege(
         'grainline_staff_read_runtime',
         'public.grainline_listing_seller_rating_summary_refresh(text)',
         'EXECUTE'
       ) AS staff_execute,
       pg_catalog.has_function_privilege(
         'public',
         'public.grainline_listing_seller_rating_summary_refresh(text)',
         'EXECUTE'
       ) AS public_execute`,
  ))[0];
  assert.deepEqual(ratingRefreshPrivilege, {
    runtime_execute: true,
    staff_execute: false,
    public_execute: false,
  });
  const ratingReviewIds = [
    `listing-rating-review-a-${suffix}`,
    `listing-rating-review-b-${suffix}`,
  ];
  await database.query(
    `INSERT INTO public."Review"
       (id, "listingId", "reviewerId", "reviewerAccountActive",
        "ratingX2", verified, "createdAt", "updatedAt")
     VALUES
       ($1, $3, $5, true, 10, true, $6, $6),
       ($2, $4, $5, true, 8, true, $7, $7)`,
    [
      ratingReviewIds[0],
      ratingReviewIds[1],
      listingId,
      transactionListingId,
      buyerId,
      new Date("2026-01-15T12:00:00.000Z"),
      new Date("2026-02-10T12:00:00.000Z"),
    ],
  );
  await database.query(
    `INSERT INTO public."SellerRatingSummary"
       ("sellerProfileId", "averageRating", "reviewCount", "updatedAt")
     VALUES ($1, 1.25, 99, pg_catalog.clock_timestamp())
     ON CONFLICT ("sellerProfileId") DO UPDATE
       SET "averageRating" = EXCLUDED."averageRating",
           "reviewCount" = EXCLUDED."reviewCount",
           "updatedAt" = EXCLUDED."updatedAt"`,
    [seller.sellerProfileId],
  );
  const expectedRatingSummary = rowsOf(await database.query(
    `SELECT
       COALESCE(
         pg_catalog.avg(review."ratingX2")::double precision / 2.0,
         0.0
       ) AS "averageRating",
       pg_catalog.count(review.id)::integer AS "reviewCount"
       FROM public."Review" AS review
       JOIN public."Listing" AS listing
         ON listing.id = review."listingId"
      WHERE listing."sellerId" = $1`,
    [seller.sellerProfileId],
  ))[0];
  const refreshedRatingSummary = rowsOf(await runtimeQuery(
    database,
    buyerId,
    LISTING_SELLER_RATING_SUMMARY_REFRESH_SQL,
    [seller.sellerProfileId],
  ));
  assert.deepEqual(
    refreshedRatingSummary,
    [expectedRatingSummary],
    "seller rating refresh computes the exact aggregate",
  );
  assert.notDeepEqual(
    refreshedRatingSummary,
    [{ averageRating: 1.25, reviewCount: 99 }],
    "seller rating refresh replaces stale summary values",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      buyerId,
      LISTING_SELLER_RATING_SUMMARY_REFRESH_SQL,
      ["bad seller id with spaces"],
    ),
    /Listing seller rating-summary input is invalid/u,
    "seller rating refresh rejects malformed seller ids",
  );
  const ratingStart = Date.parse("2026-01-01T00:00:00.000Z");
  const ratingEnd = Date.parse("2026-03-01T00:00:00.000Z");
  const ratingBuckets = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    LISTING_OWNER_RATING_BUCKETS_SQL,
    [ratingStart, ratingEnd, true],
  )).map((row) => ({
    ...row,
    bucketEpochMillis: Number(row.bucketEpochMillis),
    reviewCount: Number(row.reviewCount),
  }));
  assert.deepEqual(ratingBuckets, [
    {
      bucketEpochMillis: Date.parse("2026-01-01T00:00:00.000Z"),
      averageRating: 5,
      reviewCount: 1,
    },
    {
      bucketEpochMillis: Date.parse("2026-02-01T00:00:00.000Z"),
      averageRating: 4,
      reviewCount: 1,
    },
  ], "owner rating buckets preserve monthly averages");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    LISTING_OWNER_RATING_BUCKETS_SQL,
    [ratingStart, ratingEnd, true],
  )), [], "cross-owner rating buckets are empty");
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      LISTING_OWNER_RATING_BUCKETS_SQL,
      [ratingStart, ratingEnd, true],
    ),
    /Listing owner rating-bucket input is invalid/u,
    "missing-actor rating buckets fail closed",
  );
  const publicTransactionSource = rowsOf(await runtimeQuery(
    database,
    buyerId,
    LISTING_TRANSACTION_SOURCE_SQL,
    [transactionListingId],
  ));
  assert.equal(publicTransactionSource.length, 1);
  assert.equal(publicTransactionSource[0]?.sellerId, seller.sellerProfileId);
  assert.deepEqual(publicTransactionSource[0]?.photos, [{
    url: "https://example.test/transaction-source.jpg",
  }]);
  assert.deepEqual(publicTransactionSource[0]?.variantGroups, [{
    id: transactionGroupId,
    name: "Finish",
    options: [{
      id: transactionOptionId,
      label: "Natural",
      priceAdjustCents: 500,
      inStock: true,
    }],
  }]);
  assert.equal(
    Object.hasOwn(publicTransactionSource[0]?.photos?.[0] ?? {}, "originalUrl"),
    false,
    "Transaction source must not expose pre-crop photo URLs",
  );
  await database.query(
    `UPDATE public."Listing"
        SET "isPrivate" = true, "reservedForUserId" = NULL
      WHERE id = $1`,
    [transactionListingId],
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    LISTING_TRANSACTION_SOURCE_SQL,
    [transactionListingId],
  )), [], "Unreserved private listings must be absent from transaction source");
  await database.query(
    `UPDATE public."Listing"
        SET "reservedForUserId" = $2
      WHERE id = $1`,
    [transactionListingId, buyerId],
  );
  assert.equal(rowsOf(await runtimeQuery(
    database,
    buyerId,
    LISTING_TRANSACTION_SOURCE_SQL,
    [transactionListingId],
  )).length, 1, "Exact reserved buyer must retain transaction access");

  const transactionCartId = `listing-transaction-cart-${suffix}`;
  const transactionCartItemId = `listing-transaction-cart-item-${suffix}`;
  await database.query(
    `INSERT INTO public."Cart" (id, "userId", "createdAt", "updatedAt")
     VALUES ($1, $2, pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())`,
    [transactionCartId, buyerId],
  );
  await database.query(
    `INSERT INTO public."CartItem"
       (id, "cartId", "listingId", quantity, "priceCents", "priceVersion",
        "selectedVariantOptionIds", "variantKey", "createdAt")
     VALUES ($1, $2, $3, 1, 25500, 1, $4::text[], $5, pg_catalog.clock_timestamp())`,
    [
      transactionCartItemId,
      transactionCartId,
      transactionListingId,
      [transactionOptionId],
      transactionOptionId,
    ],
  );
  const activeCartSource = rowsOf(await runtimeQuery(
    database,
    buyerId,
    LISTING_CART_TRANSACTION_SOURCES_SQL,
    [transactionCartId],
  ));
  assert.equal(activeCartSource.length, 1);
  assert.equal(activeCartSource[0]?.cartItemId, transactionCartItemId);
  assert.equal(activeCartSource[0]?.id, transactionListingId);
  assert.equal(
    Object.hasOwn(activeCartSource[0]?.photos?.[0] ?? {}, "originalUrl"),
    false,
    "Cart transaction source must not expose pre-crop photo URLs",
  );
  await database.query(
    `UPDATE public."Listing"
        SET status = 'HIDDEN', "archivedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1`,
    [transactionListingId],
  );
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    buyerId,
    LISTING_TRANSACTION_SOURCE_SQL,
    [transactionListingId],
  )), [], "Archived listings must be absent from transaction source");
  const archivedCartSource = rowsOf(await runtimeQuery(
    database,
    buyerId,
    LISTING_CART_TRANSACTION_SOURCES_SQL,
    [transactionCartId],
  ));
  assert.equal(archivedCartSource.length, 1);
  assert.equal(archivedCartSource[0]?.status, "HIDDEN");
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    LISTING_CART_TRANSACTION_SOURCES_SQL,
    [transactionCartId],
  )), [], "Another actor must not read the cart owner's listing sources");
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      LISTING_CART_TRANSACTION_SOURCES_SQL,
      [transactionCartId],
    ),
    /Listing actor cart transaction-source input is invalid/u,
    "Cart transaction source must reject an absent actor",
  );

  const stockListingId = `listing-stock-restore-proof-${suffix}`;
  const stockPhotoId = `listing-stock-restore-photo-${suffix}`;
  const stockCreate = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    CREATE_SQL,
    createArgs({
      listingId: stockListingId,
      title: "Legacy stock restore full-chain proof",
      listingType: "IN_STOCK",
      stockQuantity: 1,
      photos: [{
        id: stockPhotoId,
        url: "https://example.test/stock-restore.jpg",
        originalUrl: "https://example.test/stock-restore.jpg",
        altText: "Stock restore proof",
        sortOrder: 0,
      }],
    }),
  ));
  assert.equal(stockCreate[0]?.created, true);
  await database.query(
    `UPDATE public."Listing"
        SET status = 'SOLD_OUT', "stockQuantity" = 0
      WHERE id = $1`,
    [stockListingId],
  );
  const restoreSessionId = `cs_test_${suffix.replaceAll("-", "")}`;
  const restoreItems = JSON.stringify([{ listingId: stockListingId, quantity: 2 }]);
  const firstRestore = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    LEGACY_STOCK_RESTORE_SQL,
    [restoreSessionId, restoreItems],
  ));
  assert.deepEqual(
    firstRestore,
    [{ claimed: true, stock_visibility_changed: 1 }],
    "Legacy stock restore must apply exactly once",
  );
  assert.deepEqual(rowsOf(await database.query(
    `SELECT status::text AS status, "stockQuantity" AS "stockQuantity"
       FROM public."Listing"
      WHERE id = $1`,
    [stockListingId],
  )), [{ status: "ACTIVE", stockQuantity: 2 }]);
  const replayRestore = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    LEGACY_STOCK_RESTORE_SQL,
    [restoreSessionId, restoreItems],
  ));
  assert.deepEqual(
    replayRestore,
    [{ claimed: false, stock_visibility_changed: 0 }],
    "Legacy stock restore replay must not duplicate stock",
  );
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "stockQuantity" AS "stockQuantity"
       FROM public."Listing"
      WHERE id = $1`,
    [stockListingId],
  )), [{ stockQuantity: 2 }]);

  const deletionUserId = `listing-deletion-user-${suffix}`;
  const deletionSellerId = `listing-deletion-seller-${suffix}`;
  const deletionListingId = `listing-deletion-listing-${suffix}`;
  const deletionPhotoId = `listing-deletion-photo-${suffix}`;
  const deletionGroupId = `listing-deletion-group-${suffix}`;
  const deletionOptionId = `listing-deletion-option-${suffix}`;
  const deletionEffectId = `listing-deletion-effect-${suffix}`;
  const deletionClaimToken = randomUUID();
  const deletionAt = new Date();
  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES (
       $1, $2, $3, 'Listing deletion proof seller', $4, $4,
       $4, '2026-01-01', $4
     )`,
    [
      deletionUserId,
      `clerk_${deletionUserId}`,
      `${deletionUserId}@example.test`,
      deletionAt,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerProfile"
       (id, "userId", "displayName", "displayNameNormalized", city, state,
        "chargesEnabled", "stripeAccountSupported", "ownerAccountActive",
        "createdAt", "updatedAt")
     VALUES (
       $1, $2, 'Listing deletion proof', $3, 'Austin', 'TX',
       true, true, true, $4, $4
     )`,
    [deletionSellerId, deletionUserId, deletionSellerId.toLowerCase(), deletionAt],
  );
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", status,
        "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt")
     VALUES (
       $1, $2, 'Sensitive seller title', 'Sensitive seller description', 4000,
       'ACTIVE', 'IN_STOCK', 3, false, $3, $3
     )`,
    [deletionListingId, deletionSellerId, deletionAt],
  );
  await database.query(
    `INSERT INTO public."Photo"
       (id, "listingId", url, "originalUrl", "altText", "sortOrder", "createdAt")
     VALUES ($1, $2, $3, $3, 'Sensitive seller photo', 0, $4)`,
    [deletionPhotoId, deletionListingId, "https://example.test/deletion.jpg", deletionAt],
  );
  await database.query(
    `INSERT INTO public."ListingVariantGroup" (id, "listingId", name, "sortOrder")
     VALUES ($1, $2, 'Sensitive option', 0)`,
    [deletionGroupId, deletionListingId],
  );
  await database.query(
    `INSERT INTO public."ListingVariantOption"
       (id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock")
     VALUES ($1, $2, 'Sensitive value', 0, 0, true)`,
    [deletionOptionId, deletionGroupId],
  );
  await database.query(
    `INSERT INTO public."AccountDeletionSideEffect"
       (id, "userId", kind, "dedupKey", payload, status, attempts,
        "claimGeneration", "claimToken", "processingStartedAt",
        "createdAt", "updatedAt")
     VALUES (
       $1::text, $2::text, 'LOCAL_ANONYMIZE',
       'account-delete:local:' || $2::text,
       '{}'::jsonb, 'PROCESSING', 1, 1, $3::uuid,
       $4::timestamp, $4::timestamp, $4::timestamp
     )`,
    [deletionEffectId, deletionUserId, deletionClaimToken, deletionAt],
  );
  await assert.rejects(
    runtimeQuery(
      database,
      deletionUserId,
      LISTING_ACCOUNT_DELETION_SQL,
      [deletionEffectId, buyerId, 1, deletionClaimToken, deletionAt],
    ),
    (error) => error?.code === "42501",
    "Listing deletion authority must reject a mismatched claimed user",
  );
  const deletionResult = rowsOf(await runtimeQuery(
    database,
    deletionUserId,
    LISTING_ACCOUNT_DELETION_SQL,
    [deletionEffectId, deletionUserId, 1, deletionClaimToken, deletionAt],
  ));
  assert.deepEqual(deletionResult, [{
    seller_profile_id: deletionSellerId,
    photos_deleted: 1,
    variant_groups_deleted: 1,
    listings_redacted: 1,
  }]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT title, status::text AS status, "isPrivate" AS "isPrivate",
            description, "videoUrl" AS "videoUrl", tags,
            "metaDescription" AS "metaDescription", materials,
            "aiReviewFlags" AS "aiReviewFlags", "aiReviewScore" AS "aiReviewScore",
            "rejectionReason" AS "rejectionReason"
       FROM public."Listing"
      WHERE id = $1`,
    [deletionListingId],
  )), [{
    title: "Deleted listing",
    status: "HIDDEN",
    isPrivate: true,
    description: "[Listing removed]",
    videoUrl: null,
    tags: [],
    metaDescription: null,
    materials: [],
    aiReviewFlags: [],
    aiReviewScore: null,
    rejectionReason: "Seller account deleted",
  }], "Listing deletion authority must remove children and redact the parent");
  assert.deepEqual(rowsOf(await database.query(
    `SELECT
       (SELECT pg_catalog.count(*)::integer FROM public."Photo" WHERE "listingId" = $1) AS photos,
       (SELECT pg_catalog.count(*)::integer FROM public."ListingVariantGroup" WHERE "listingId" = $1) AS groups,
       (SELECT pg_catalog.count(*)::integer FROM public."ListingVariantOption" WHERE "groupId" = $2) AS options`,
    [deletionListingId, deletionGroupId],
  )), [{ photos: 0, groups: 0, options: 0 }]);

  await assert.rejects(
    runtimeQuery(
      database,
      seller.userId,
      UPDATE_SQL,
      updateArgs({
        listingId,
        listing,
        title: "This parent update must roll back",
        photos: [],
        variantGroups: replacementGroups,
      }),
    ),
    (error) => error?.code === "22023",
    "invalid child data must roll back the parent update atomically",
  );
  assert.deepEqual(rowsOf(await database.query(
    `SELECT title FROM public."Listing" WHERE id = $1`,
    [listingId],
  )), [{ title: "Updated full-chain listing authority proof" }]);

  const crossActor = rowsOf(await runtimeQuery(
    database,
    buyerId,
    UPDATE_SQL,
    updateArgs({
      listingId,
      listing,
      title: "Forbidden cross-owner update",
      photos: replacementPhotos,
      variantGroups: replacementGroups,
    }),
  ));
  assert.equal(crossActor[0]?.applied, false);

  const [userAId, userBId] = [seller.userId, buyerId].sort();
  await database.query(
    `INSERT INTO public."Conversation"
       (id, "userAId", "userBId", "createdAt", "updatedAt")
     VALUES (
       $1, $2, $3,
       pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp()
     )`,
    [conversationId, userAId, userBId],
  );
  const customListingId = `listing-custom-proof-${suffix}`;
  const customCreate = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    CREATE_SQL,
    createArgs({
      listingId: customListingId,
      status: "PENDING_REVIEW",
      isPrivate: true,
      reservedForUserId: buyerId,
      conversationId,
      title: "Reserved full-chain listing authority proof",
      photos: [],
    }),
  ));
  assert.equal(customCreate[0]?.created, true);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT "reservedForUserId" AS "reservedForUserId",
            "customOrderConversationId" AS "customOrderConversationId",
            status::text AS status
       FROM public."Listing"
      WHERE id = $1`,
    [customListingId],
  )), [{
    reservedForUserId: buyerId,
    customOrderConversationId: conversationId,
    status: "PENDING_REVIEW",
  }]);
  assert.deepEqual(rowsOf(await database.query(
    `SELECT pg_catalog.count(*)::integer AS count
       FROM public."Photo"
      WHERE "listingId" = $1`,
    [customListingId],
  )), [{ count: 0 }]);

  const privateCore = rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `SELECT NOT pg_catalog.has_function_privilege(
       current_user,
       'public.grainline_listing_children_replace_core(text,integer,jsonb,jsonb)',
       'EXECUTE'
     ) AS denied`,
  ));
  assert.equal(privateCore[0]?.denied, true);
}
