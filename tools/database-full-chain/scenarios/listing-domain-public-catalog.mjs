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
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
        "archivedAt", tags, materials, category, "metroId",
        "sellerPubliclyOrderable", "createdAt", "updatedAt")
     VALUES
       ($1, $5, 'Catalog oak table', 'Matching catalog row', 1000, 'usd', 'ACTIVE',
        'IN_STOCK', 1, false, NULL, NULL, ARRAY['oak'], ARRAY['oak'], 'FURNITURE',
        $6, true, $7, $7),
       ($2, $5, 'Catalog walnut table', 'Wrong tag row', 1100, 'usd', 'ACTIVE',
        'IN_STOCK', 1, false, NULL, NULL, ARRAY['walnut'], ARRAY['walnut'], 'FURNITURE',
        $6, true, $7, $7),
       ($3, $5, 'Private oak table', 'Private catalog row', 1200, 'usd', 'ACTIVE',
        'IN_STOCK', 1, true, $8, NULL, ARRAY['oak'], ARRAY['oak'], 'FURNITURE',
        $6, true, $7, $7),
       ($4, $5, 'Sold out oak table', 'Sold-out catalog row', 1300, 'usd', 'SOLD_OUT',
        'IN_STOCK', 0, false, NULL, NULL, ARRAY['oak'], ARRAY['oak'], 'FURNITURE',
        $6, true, $7, $7)`,
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
      "sellerId",
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
}
