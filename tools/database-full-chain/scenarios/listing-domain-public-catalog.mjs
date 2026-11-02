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

function pageOf(result) {
  const rows = rowsOf(result);
  assert.equal(rows.length, 1);
  return rows[0];
}

export async function proveListingDomainPublicCatalog({ database, seller }) {
  const suffix = randomUUID();
  const actorId = `listing-catalog-actor-${suffix}`;
  const listingIds = {
    matching: `listing-catalog-matching-${suffix}`,
    wrongTag: `listing-catalog-wrong-tag-${suffix}`,
    private: `listing-catalog-private-${suffix}`,
    soldOut: `listing-catalog-sold-out-${suffix}`,
  };
  const photoId = `listing-catalog-photo-${suffix}`;
  const blockId = `listing-catalog-block-${suffix}`;
  const metroId = `listing-catalog-metro-${suffix}`;
  const now = "2026-11-02 13:00:00";
  const [originalSellerLocation] = rowsOf(await database.query(
    `SELECT lat, lng, "radiusMeters"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ));
  const [originalSellerRating] = rowsOf(await database.query(
    `SELECT "averageRating", "reviewCount", "updatedAt"
       FROM public."SellerRatingSummary"
      WHERE "sellerProfileId" = $1`,
    [seller.sellerProfileId],
  ));

  const privilege = rowsOf(await database.query(`
    SELECT pg_catalog.has_function_privilege(
             'grainline_app_runtime',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_public_catalog_page(jsonb,integer,integer)'
             ),
             'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_public_catalog_page(jsonb,integer,integer)'
             ),
             'EXECUTE'
           ) AS "staffExecute",
           pg_catalog.has_function_privilege(
             'public',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_public_catalog_page(jsonb,integer,integer)'
             ),
             'EXECUTE'
           ) AS "publicExecute"
  `))[0];
  assert.deepEqual(privilege, {
    runtimeExecute: true,
    staffExecute: false,
    publicExecute: false,
  });

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Catalog actor', 'USER', $4, $4, $4, '2026-01-01', $4)`,
    [
      actorId,
      `clerk_${actorId}`.slice(0, 191),
      `${actorId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Metro"
       (id, name, state, slug, latitude, longitude, "radiusMiles",
        "isActive", "createdAt", "updatedAt")
     VALUES ($1, 'Catalog City', 'TX', $2, 30.2672, -97.7431, 45,
             true, $3, $3)`,
    [metroId, `catalog-city-${suffix}`.slice(0, 191), now],
  );
  await database.query(
    `UPDATE public."SellerProfile"
        SET lat = 30.2672,
            lng = -97.7431,
            "radiusMeters" = 0
      WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `INSERT INTO public."SellerRatingSummary"
       ("sellerProfileId", "averageRating", "reviewCount", "updatedAt")
     VALUES ($1, 4.8, 12, $2)
     ON CONFLICT ("sellerProfileId") DO UPDATE
       SET "averageRating" = EXCLUDED."averageRating",
           "reviewCount" = EXCLUDED."reviewCount",
           "updatedAt" = EXCLUDED."updatedAt"`,
    [seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
        "archivedAt", tags, materials, category, "metroId", "shipsWithinDays",
        "qualityScore",
        "sellerPubliclyOrderable", "createdAt", "updatedAt")
     VALUES
       ($1, $5, 'Catalog oak table', 'Matching catalog row', 1000, 'usd', 'ACTIVE',
        'IN_STOCK', 1, false, NULL, NULL, ARRAY['oak'], ARRAY['oak'], 'FURNITURE',
        $6, 3, 0.8,
        true, $7, $7),
       ($2, $5, 'Catalog walnut table', 'Wrong tag row', 1100, 'usd', 'ACTIVE',
        'IN_STOCK', 1, false, NULL, NULL, ARRAY['walnut'], ARRAY['walnut'], 'FURNITURE',
        $6, 10, 0.9,
        true, $7, $7),
       ($3, $5, 'Private oak table', 'Private catalog row', 1200, 'usd', 'ACTIVE',
        'IN_STOCK', 1, true, $8, NULL, ARRAY['oak'], ARRAY['oak'], 'FURNITURE',
        $6, 3, 0.7,
        true, $7, $7),
       ($4, $5, 'Sold out oak table', 'Sold-out catalog row', 1300, 'usd', 'SOLD_OUT',
        'IN_STOCK', 0, false, NULL, NULL, ARRAY['oak'], ARRAY['oak'], 'FURNITURE',
        $6, 3, 0.7,
        true, $7, $7)`,
    [
      listingIds.matching,
      listingIds.wrongTag,
      listingIds.private,
      listingIds.soldOut,
      seller.sellerProfileId,
      metroId,
      now,
      actorId,
    ],
  );
  await database.query(
    `UPDATE public."Listing"
        SET "sellerPubliclyOrderable" = true
      WHERE id = ANY($1::text[])`,
    [Object.values(listingIds)],
  );
  await database.query(
    `INSERT INTO public."Favorite" ("userId", "listingId", "createdAt")
     VALUES ($1, $2, $3)`,
    [actorId, listingIds.wrongTag, now],
  );
  await database.query(
    `INSERT INTO public."Photo"
       (id, "listingId", url, "originalUrl", "altText", "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://cdn.example.test/catalog.jpg',
             'https://private.example.test/catalog-original.jpg',
             'Catalog photo', 0, $3)`,
    [photoId, listingIds.matching, now],
  );

  const sourceSql = `
    SELECT *
      FROM public.grainline_listing_public_catalog_page(
        $1::jsonb, $2::integer, $3::integer
      )
  `;
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      sourceSql,
      [JSON.stringify({ unexpected: true }), 0, 24],
    ),
    /Public catalog filter is invalid/u,
    "unknown public-catalog filters fail closed",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      sourceSql,
      [JSON.stringify({ selectedTags: "oak" }), 0, 24],
    ),
    /Public catalog filter value is invalid/u,
    "malformed browse arrays fail closed",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      sourceSql,
      [JSON.stringify({ locationLat: 30.2672 }), 0, 24],
    ),
    /Public catalog filter is outside the supported range/u,
    "partial browse location fails closed",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      sourceSql,
      [JSON.stringify({ sort: "relevant" }), 0, 24],
    ),
    /Public catalog filter is outside the supported range/u,
    "relevance without a query fails closed",
  );
  const tagPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({ tag: "oak", sort: "quality" }), 0, 24],
  ));
  assert.equal(Number(tagPage.totalCount), 1, "tag filter count");
  assert.deepEqual(
    tagPage.listings.map((listing) => listing.id),
    [listingIds.matching],
    "tag filter rows",
  );
  assert.deepEqual(
    Object.keys(tagPage.listings[0]).sort(),
    [
      "currency",
      "id",
      "listingType",
      "photos",
      "priceCents",
      "processingTimeMaxDays",
      "processingTimeMinDays",
      "sellerId",
      "shipsWithinDays",
      "status",
      "stockQuantity",
      "title",
    ],
    "public catalog card projection",
  );
  assert.equal(
    JSON.stringify(tagPage).includes("originalUrl"),
    false,
    "originalUrl must not cross the public catalog boundary",
  );
  assert.deepEqual(tagPage.listings[0].photos, [{
    id: photoId,
    url: "https://cdn.example.test/catalog.jpg",
    altText: "Catalog photo",
  }]);

  const metroCategoryPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({
      metroId,
      category: "FURNITURE",
      tag: "oak",
      sort: "newest",
    }), 0, 24],
  ));
  assert.equal(Number(metroCategoryPage.totalCount), 1, "metro category filter count");
  assert.deepEqual(
    metroCategoryPage.listings.map((listing) => listing.id),
    [listingIds.matching],
    "metro category filter rows",
  );
  assert.equal(
    metroCategoryPage.listings.some((listing) => listing.id === listingIds.private),
    false,
    "private listing exclusion",
  );
  assert.equal(
    metroCategoryPage.listings.some((listing) => listing.id === listingIds.soldOut),
    false,
    "sold-out listing exclusion",
  );

  const facetPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({
      metroId,
      sort: "newest",
      includeCategoryCounts: true,
    }), 0, 24],
  ));
  assert.deepEqual(
    facetPage.categoryCounts,
    [{ category: "FURNITURE", count: 2 }],
    "category facets",
  );

  const textSearchPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({ metroId, query: "oak", sort: "relevant" }), 0, 24],
  ));
  assert.deepEqual(
    textSearchPage.listings.map((listing) => listing.id),
    [listingIds.matching],
    "browse text relevance",
  );
  const literalWildcardPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({ metroId, query: "%", sort: "relevant" }), 0, 24],
  ));
  assert.deepEqual(
    literalWildcardPage.listings,
    [],
    "browse search treats wildcard characters literally",
  );

  const selectedTagPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({ metroId, selectedTags: ["walnut"], sort: "newest" }), 0, 24],
  ));
  assert.deepEqual(
    selectedTagPage.listings.map((listing) => listing.id),
    [listingIds.wrongTag],
    "browse selected-tag filter",
  );

  const pricePage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({ metroId, minPriceCents: 1050, maxPriceCents: 1150 }), 0, 24],
  ));
  assert.deepEqual(
    pricePage.listings.map((listing) => listing.id),
    [listingIds.wrongTag],
    "browse price filter",
  );

  const shippingPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({ metroId, listingType: "IN_STOCK", shipsWithinDays: 3 }), 0, 24],
  ));
  assert.deepEqual(
    shippingPage.listings.map((listing) => listing.id),
    [listingIds.matching],
    "browse shipping filter",
  );

  const ratingPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({ metroId, minimumSellerRating: 4.5 }), 0, 24],
  ));
  assert.deepEqual(
    ratingPage.listings.map((listing) => listing.id).sort(),
    [listingIds.matching, listingIds.wrongTag].sort(),
    "browse rating filter",
  );

  const locationPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({
      locationLat: 30.2672,
      locationLng: -97.7431,
      locationRadiusMiles: 5,
      metroId,
    }), 0, 24],
  ));
  assert.deepEqual(
    locationPage.listings.map((listing) => listing.id).sort(),
    [listingIds.matching, listingIds.wrongTag].sort(),
    "browse location filter",
  );

  const popularPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({ metroId, sort: "popular" }), 0, 4],
  ));
  assert.equal(
    popularPage.listings[0]?.id,
    listingIds.wrongTag,
    "browse popular fallback",
  );

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, actorId, seller.userId, now],
  );
  const blockedPage = pageOf(await runtimeQuery(
    database,
    actorId,
    sourceSql,
    [JSON.stringify({ tag: "oak" }), 0, 24],
  ));
  assert.equal(Number(blockedPage.totalCount), 0, "blocked seller exclusion");
  assert.deepEqual(blockedPage.listings, []);

  await database.query(
    `UPDATE public."SellerProfile"
        SET lat = $2,
            lng = $3,
            "radiusMeters" = $4
      WHERE id = $1`,
    [
      seller.sellerProfileId,
      originalSellerLocation?.lat ?? null,
      originalSellerLocation?.lng ?? null,
      originalSellerLocation?.radiusMeters ?? null,
    ],
  );
  if (originalSellerRating) {
    await database.query(
      `INSERT INTO public."SellerRatingSummary"
         ("sellerProfileId", "averageRating", "reviewCount", "updatedAt")
       VALUES ($1, $2, $3, $4)
       ON CONFLICT ("sellerProfileId") DO UPDATE
         SET "averageRating" = EXCLUDED."averageRating",
             "reviewCount" = EXCLUDED."reviewCount",
             "updatedAt" = EXCLUDED."updatedAt"`,
      [
        seller.sellerProfileId,
        originalSellerRating.averageRating,
        originalSellerRating.reviewCount,
        originalSellerRating.updatedAt,
      ],
    );
  } else {
    await database.query(
      `DELETE FROM public."SellerRatingSummary"
        WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId],
    );
  }
}
