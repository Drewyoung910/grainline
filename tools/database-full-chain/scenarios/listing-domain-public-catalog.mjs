import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { runPsqlScript } from "./psql-script.mjs";

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

async function runRuntimeProvisioning(database, repositoryRoot) {
  const source = readFileSync(
    join(repositoryRoot, "scripts/provision-runtime-db-role.sql"),
    "utf8",
  );
  return runPsqlScript(database, source, {
    runtime_role: "grainline_app_runtime",
    migration_role: "ci",
  });
}

async function expectProvisioningRefusal(database, repositoryRoot, message) {
  await assert.rejects(
    runRuntimeProvisioning(database, repositoryRoot),
    (error) => error?.code === "P0001"
      && /runtime-role provisioning refused/u.test(error.message),
    message,
  );
}

function pageOf(result) {
  const rows = rowsOf(result);
  assert.equal(rows.length, 1);
  return rows[0];
}

async function readActivationPosture(database) {
  return rowsOf(await database.query(`
    SELECT relation.relname AS table_name,
           relation.relrowsecurity AS rls_enabled,
           relation.relforcerowsecurity AS rls_forced,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'SELECT'
           ) AS runtime_select,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'INSERT'
           ) AS runtime_insert,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'UPDATE'
           ) AS runtime_update,
           pg_catalog.has_table_privilege(
             'grainline_app_runtime', relation.oid, 'DELETE'
           ) AS runtime_delete,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = relation.oid) AS policy_count,
           CASE WHEN relation.relname = 'Listing' THEN (
             SELECT constraint_state.convalidated
               FROM pg_catalog.pg_constraint AS constraint_state
              WHERE constraint_state.conrelid = relation.oid
                AND constraint_state.conname =
                    'Listing_public_reservation_routing_chk'
           ) ELSE NULL END AS reservation_guard_validated
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = ANY($1::text[])
     ORDER BY relation.relname
  `, [[
    "Listing",
    "ListingVariantGroup",
    "ListingVariantOption",
    "Photo",
  ]]));
}

async function provePredecessorRuntimeCrud({ database, seller }) {
  const suffix = randomUUID();
  const listingId = `listing-rollback-${suffix}`;
  const photoId = `photo-rollback-${suffix}`;
  const groupId = `group-rollback-${suffix}`;
  const optionId = `option-rollback-${suffix}`;

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", status,
        "listingType", "stockQuantity", "isPrivate", "sellerPubliclyOrderable",
        "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'Rollback predecessor listing', 'Executed rollback proof', 2500,
        'DRAFT', 'MADE_TO_ORDER', NULL, false, false,
        pg_catalog.clock_timestamp(), pg_catalog.clock_timestamp())
     RETURNING id`,
    [listingId, seller.sellerProfileId],
  )), [{ id: listingId }]);

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `INSERT INTO public."Photo"
       (id, "listingId", url, "originalUrl", "altText", "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://cdn.example.test/rollback.jpg',
             'https://cdn.example.test/rollback-original.jpg',
             'Rollback predecessor photo', 0, pg_catalog.clock_timestamp())
     RETURNING id`,
    [photoId, listingId],
  )), [{ id: photoId }]);

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `INSERT INTO public."ListingVariantGroup" (id, "listingId", name, "sortOrder")
     VALUES ($1, $2, 'Finish', 0)
     RETURNING id`,
    [groupId, listingId],
  )), [{ id: groupId }]);

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `INSERT INTO public."ListingVariantOption"
       (id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock")
     VALUES ($1, $2, 'Natural', 0, 0, true)
     RETURNING id`,
    [optionId, groupId],
  )), [{ id: optionId }]);

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `SELECT listing.id AS listing_id,
            photo.id AS photo_id,
            variant_group.id AS group_id,
            variant_option.id AS option_id
       FROM public."Listing" AS listing
       JOIN public."Photo" AS photo ON photo."listingId" = listing.id
       JOIN public."ListingVariantGroup" AS variant_group
         ON variant_group."listingId" = listing.id
       JOIN public."ListingVariantOption" AS variant_option
         ON variant_option."groupId" = variant_group.id
      WHERE listing.id = $1`,
    [listingId],
  )), [{
    listing_id: listingId,
    photo_id: photoId,
    group_id: groupId,
    option_id: optionId,
  }]);

  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `UPDATE public."Listing"
        SET title = 'Rollback predecessor listing updated',
            "updatedAt" = pg_catalog.clock_timestamp()
      WHERE id = $1
      RETURNING title`,
    [listingId],
  )), [{ title: "Rollback predecessor listing updated" }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `UPDATE public."Photo" SET "altText" = 'Rollback photo updated'
      WHERE id = $1 RETURNING "altText" AS alt_text`,
    [photoId],
  )), [{ alt_text: "Rollback photo updated" }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `UPDATE public."ListingVariantGroup" SET name = 'Material'
      WHERE id = $1 RETURNING name`,
    [groupId],
  )), [{ name: "Material" }]);
  assert.deepEqual(rowsOf(await runtimeQuery(
    database,
    seller.userId,
    `UPDATE public."ListingVariantOption" SET label = 'Walnut'
      WHERE id = $1 RETURNING label`,
    [optionId],
  )), [{ label: "Walnut" }]);

  for (const [table, id] of [
    ["ListingVariantOption", optionId],
    ["Photo", photoId],
    ["ListingVariantGroup", groupId],
    ["Listing", listingId],
  ]) {
    assert.deepEqual(rowsOf(await runtimeQuery(
      database,
      seller.userId,
      `DELETE FROM public."${table}" WHERE id = $1 RETURNING id`,
      [id],
    )), [{ id }]);
  }
}

async function proveListingDomainRollback({ database, repositoryRoot, seller }) {
  const rollback = readFileSync(
    join(repositoryRoot, "docs/rls-drafts/listing-domain-activation-rollback.sql"),
    "utf8",
  );
  const activation = readFileSync(
    join(
      repositoryRoot,
      "prisma/migrations/20261102060000_activate_listing_domain_rls/migration.sql",
    ),
    "utf8",
  );

  await runPsqlScript(database, rollback);
  assert.deepEqual(await readActivationPosture(database), [
    ["Listing", false],
    ["ListingVariantGroup", null],
    ["ListingVariantOption", null],
    ["Photo", null],
  ].map(([tableName, reservationGuardValidated]) => ({
    table_name: tableName,
    rls_enabled: false,
    rls_forced: false,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
    policy_count: 0,
    reservation_guard_validated: reservationGuardValidated,
  })));
  await runRuntimeProvisioning(database, repositoryRoot);
  assert.deepEqual(await readActivationPosture(database), [
    ["Listing", false],
    ["ListingVariantGroup", null],
    ["ListingVariantOption", null],
    ["Photo", null],
  ].map(([tableName, reservationGuardValidated]) => ({
    table_name: tableName,
    rls_enabled: false,
    rls_forced: false,
    runtime_select: true,
    runtime_insert: true,
    runtime_update: true,
    runtime_delete: true,
    policy_count: 0,
    reservation_guard_validated: reservationGuardValidated,
  })), "provisioning preserves a database-first rollback despite the applied ledger");
  await provePredecessorRuntimeCrud({ database, seller });

  await runPsqlScript(database, activation);
  await runRuntimeProvisioning(database, repositoryRoot);
  assert.deepEqual(await readActivationPosture(database), [
    ["Listing", true],
    ["ListingVariantGroup", null],
    ["ListingVariantOption", null],
    ["Photo", null],
  ].map(([tableName, reservationGuardValidated]) => ({
    table_name: tableName,
    rls_enabled: true,
    rls_forced: true,
    runtime_select: false,
    runtime_insert: false,
    runtime_update: false,
    runtime_delete: false,
    policy_count: 1,
    reservation_guard_validated: reservationGuardValidated,
  })), "provisioning converges the exact active Listing-domain posture");

  await database.query("BEGIN");
  await database.query(
    `ALTER POLICY listing_public_select ON public."Listing" USING (true)`,
  );
  await expectProvisioningRefusal(
    database,
    repositoryRoot,
    "provisioning must reject Listing policy-expression drift",
  );

  await database.query("BEGIN");
  await database.query(
    `GRANT UPDATE (title) ON TABLE public."Listing" TO grainline_app_runtime`,
  );
  await expectProvisioningRefusal(
    database,
    repositoryRoot,
    "provisioning must reject unexpected Listing column authority",
  );

  await database.query("BEGIN");
  await database.query(
    `ALTER TABLE public."Photo" NO FORCE ROW LEVEL SECURITY`,
  );
  await expectProvisioningRefusal(
    database,
    repositoryRoot,
    "provisioning must reject a mixed Listing-domain RLS posture",
  );

  // Prisma's migration ledger id is VARCHAR(36); a UUID is both unique and
  // representative of the real ledger shape.
  const duplicateLedgerId = randomUUID();
  await database.query("BEGIN");
  await database.query(
    `INSERT INTO public._prisma_migrations
       (id, checksum, finished_at, migration_name, logs, rolled_back_at,
        started_at, applied_steps_count)
     SELECT $1, checksum, finished_at, migration_name, logs, rolled_back_at,
            started_at, applied_steps_count
       FROM public._prisma_migrations
      WHERE migration_name = '20261102060000_activate_listing_domain_rls'
      LIMIT 1`,
    [duplicateLedgerId],
  );
  await expectProvisioningRefusal(
    database,
    repositoryRoot,
    "provisioning must reject duplicate exact activation ledgers",
  );
}

export async function proveListingDomainPublicCatalog({
  database,
  repositoryRoot,
  seller,
}) {
  await proveListingDomainRollback({ database, repositoryRoot, seller });
  const suffix = randomUUID();
  const actorId = `listing-catalog-actor-${suffix}`;
  const listingIds = {
    matching: `listing-catalog-matching-${suffix}`,
    wrongTag: `listing-catalog-wrong-tag-${suffix}`,
    private: `listing-catalog-private-${suffix}`,
    soldOut: `listing-catalog-sold-out-${suffix}`,
  };
  const photoId = `listing-catalog-photo-${suffix}`;
  const variantGroupId = `listing-catalog-group-${suffix}`;
  const variantOptionId = `listing-catalog-option-${suffix}`;
  const blockId = `listing-catalog-block-${suffix}`;
  const metroId = `listing-catalog-metro-${suffix}`;
  const ownerTag = `owner-${suffix.slice(0, 12)}`;
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
           ) AS "publicExecute",
           pg_catalog.has_function_privilege(
             'grainline_app_runtime',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_public_title_suggestions(text)'
             ),
             'EXECUTE'
           ) AS "suggestionRuntimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_public_title_suggestions(text)'
             ),
             'EXECUTE'
           ) AS "suggestionStaffExecute",
           pg_catalog.has_function_privilege(
             'public',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_public_title_suggestions(text)'
             ),
             'EXECUTE'
           ) AS "suggestionPublicExecute",
           pg_catalog.has_function_privilege(
             'grainline_app_runtime',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_owner_catalog_page(text,jsonb,integer,integer)'
             ),
             'EXECUTE'
           ) AS "ownerRuntimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_owner_catalog_page(text,jsonb,integer,integer)'
             ),
             'EXECUTE'
           ) AS "ownerStaffExecute",
           pg_catalog.has_function_privilege(
             'public',
             pg_catalog.to_regprocedure(
               'public.grainline_listing_owner_catalog_page(text,jsonb,integer,integer)'
             ),
             'EXECUTE'
           ) AS "ownerPublicExecute"
  `))[0];
  assert.deepEqual(privilege, {
    runtimeExecute: true,
    staffExecute: false,
    publicExecute: false,
    suggestionRuntimeExecute: true,
    suggestionStaffExecute: false,
    suggestionPublicExecute: false,
    ownerRuntimeExecute: true,
    ownerStaffExecute: false,
    ownerPublicExecute: false,
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
        SET tags = pg_catalog.array_append(tags, $2)
      WHERE id = ANY($1::text[])`,
    [[listingIds.matching, listingIds.private, listingIds.soldOut], ownerTag],
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
  await database.query(
    `INSERT INTO public."ListingVariantGroup" (id, "listingId", name, "sortOrder")
     VALUES ($1, $2, 'Finish', 0)`,
    [variantGroupId, listingIds.matching],
  );
  await database.query(
    `INSERT INTO public."ListingVariantOption"
       (id, "groupId", label, "priceAdjustCents", "sortOrder", "inStock")
     VALUES ($1, $2, 'Natural', 0, 0, true)`,
    [variantOptionId, variantGroupId],
  );

  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      null,
      `SELECT id, title
         FROM public."Listing"
        WHERE id = ANY($1::text[])
        ORDER BY id`,
      [Object.values(listingIds)],
    )),
    [listingIds.matching, listingIds.wrongTag]
      .sort()
      .map((id) => ({
        id,
        title: id === listingIds.matching
          ? "Catalog oak table"
          : "Catalog walnut table",
      })),
    "direct Listing reads expose only active public orderable rows",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      `SELECT id, "reservedForUserId"
         FROM public."Listing"
        WHERE id = $1`,
      [listingIds.matching],
    ),
    /permission denied/u,
    "direct Listing reads cannot project private reservation columns",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      actorId,
      `UPDATE public."Listing" SET title = 'forged' WHERE id = $1`,
      [listingIds.matching],
    ),
    /permission denied/u,
    "direct Listing writes remain revoked",
  );
  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      null,
      `SELECT id, url FROM public."Photo" WHERE id = $1`,
      [photoId],
    )),
    [{ id: photoId, url: "https://cdn.example.test/catalog.jpg" }],
    "direct Photo reads expose reviewed public media",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      `SELECT id, "originalUrl" FROM public."Photo" WHERE id = $1`,
      [photoId],
    ),
    /permission denied/u,
    "direct Photo reads cannot project original media",
  );
  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      null,
      `SELECT id, "listingId", name
         FROM public."ListingVariantGroup"
        WHERE id = $1`,
      [variantGroupId],
    )),
    [{ id: variantGroupId, listingId: listingIds.matching, name: "Finish" }],
    "direct variant-group reads follow public Listing visibility",
  );
  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      null,
      `SELECT id, "groupId", label
         FROM public."ListingVariantOption"
        WHERE id = $1`,
      [variantOptionId],
    )),
    [{ id: variantOptionId, groupId: variantGroupId, label: "Natural" }],
    "direct variant-option reads follow public Listing visibility",
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
      [JSON.stringify({ listingIds: [] }), 0, 24],
    ),
    /Public catalog filter is outside the supported range/u,
    "empty listing-id filters fail closed",
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

  const exactListingPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({
      sellerId: seller.sellerProfileId,
      listingIds: [listingIds.wrongTag],
    }), 0, 4],
  ));
  assert.deepEqual(
    exactListingPage.listings.map((listing) => listing.id),
    [listingIds.wrongTag],
    "exact listing-id catalog filter",
  );

  const excludedListingPage = pageOf(await runtimeQuery(
    database,
    null,
    sourceSql,
    [JSON.stringify({
      sellerId: seller.sellerProfileId,
      listingIds: [listingIds.matching, listingIds.wrongTag],
      excludeListingId: listingIds.wrongTag,
      sort: "quality",
    }), 0, 4],
  ));
  assert.deepEqual(
    excludedListingPage.listings.map((listing) => listing.id),
    [listingIds.matching],
    "excluded listing-id catalog filter",
  );

  const suggestionSql = `
    SELECT *
      FROM public.grainline_listing_public_title_suggestions($1::text)
  `;
  const exactSuggestions = rowsOf(await runtimeQuery(
    database,
    null,
    suggestionSql,
    ["Catalog"],
  ));
  assert.deepEqual(
    new Set(exactSuggestions.map((row) => row.id)),
    new Set([listingIds.matching, listingIds.wrongTag]),
    "exact title suggestions",
  );
  assert.equal(
    exactSuggestions.every((row) => row.matchKind === "exact"),
    true,
    "exact title suggestion kinds",
  );

  const fuzzySuggestions = rowsOf(await runtimeQuery(
    database,
    null,
    suggestionSql,
    ["Catlog oak tabel"],
  ));
  assert.equal(
    fuzzySuggestions.some(
      (row) => row.id === listingIds.matching && row.matchKind === "fuzzy",
    ),
    true,
    "fuzzy title suggestions",
  );
  assert.deepEqual(
    rowsOf(await runtimeQuery(database, null, suggestionSql, ["%_"])),
    [],
    "suggestion wildcard characters are literal",
  );

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

  const ownerSql = `
    SELECT *
      FROM public.grainline_listing_owner_catalog_page(
        $1::text, $2::jsonb, $3::integer, $4::integer
      )
  `;
  assert.deepEqual(
    rowsOf(await runtimeQuery(
      database,
      actorId,
      ownerSql,
      [seller.sellerProfileId, JSON.stringify({ tag: ownerTag }), 0, 20],
    )),
    [],
    "cross-user owner catalog denial",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      null,
      ownerSql,
      [seller.sellerProfileId, JSON.stringify({ tag: ownerTag }), 0, 20],
    ),
    /Listing owner-catalog input is invalid/u,
    "missing-actor owner catalog denial",
  );
  await assert.rejects(
    runtimeQuery(
      database,
      seller.userId,
      ownerSql,
      [seller.sellerProfileId, JSON.stringify({ unexpected: true }), 0, 20],
    ),
    /Listing owner-catalog input is invalid/u,
    "unknown owner-catalog filters fail closed",
  );
  const ownerActivePage = pageOf(await runtimeQuery(
    database,
    seller.userId,
    ownerSql,
    [seller.sellerProfileId, JSON.stringify({
      tag: ownerTag,
      status: "ACTIVE",
      category: "FURNITURE",
      sort: "price_desc",
      includeCategoryCounts: true,
    }), 0, 20],
  ));
  assert.equal(Number(ownerActivePage.totalCount), 2, "owner active total");
  assert.deepEqual(
    ownerActivePage.listings.map((listing) => listing.id),
    [listingIds.private, listingIds.matching],
    "owner price ordering includes the private listing",
  );
  assert.deepEqual(
    ownerActivePage.categoryCounts,
    [{ category: "FURNITURE", count: 2 }],
    "owner category facets preserve status and tag filters",
  );
  assert.equal(
    JSON.stringify(ownerActivePage).includes("originalUrl"),
    false,
    "owner catalog excludes original media",
  );
  assert.deepEqual(ownerActivePage.listings[1].photos, [{
    url: "https://cdn.example.test/catalog.jpg",
    altText: "Catalog photo",
  }]);
  const ownerSoldOutPage = pageOf(await runtimeQuery(
    database,
    seller.userId,
    ownerSql,
    [seller.sellerProfileId, JSON.stringify({
      tag: ownerTag,
      status: "SOLD_OUT",
      sort: "newest",
    }), 0, 20],
  ));
  assert.deepEqual(
    ownerSoldOutPage.listings.map((listing) => listing.id),
    [listingIds.soldOut],
    "owner nonpublic status filter",
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
  assert.deepEqual(
    rowsOf(await runtimeQuery(database, actorId, suggestionSql, ["Catalog"])),
    [],
    "blocked title suggestions",
  );

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
