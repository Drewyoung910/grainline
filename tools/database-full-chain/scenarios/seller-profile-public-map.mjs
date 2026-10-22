import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicMapAuthority({ database, seller }) {
  const viewerUserId = `${seller.userId}_map_viewer`;
  const viewerClerkId = `user_full_chain_map_viewer_${seller.userId}`;
  const viewerEmail = `map-${seller.userId}@example.test`;
  const blockId = `${seller.sellerProfileId}_map_block`;
  const followId = `${seller.sellerProfileId}_map_follow`;
  const listingId = `${seller.sellerProfileId}_map_listing`;
  const photoId = `${seller.sellerProfileId}_map_photo`;
  const reviewId = `${seller.sellerProfileId}_sitemap_review`;
  const reviewPhotoId = `${seller.sellerProfileId}_sitemap_review_photo`;
  const blogPostId = `${seller.sellerProfileId}_public_blog_post`;
  const conversationId = `${seller.sellerProfileId}_participant_card_conversation`;
  const metroId = `${seller.sellerProfileId}_public_metro`;
  // Run after the historical refund/case fixtures so this scenario's listing
  // is the newest public listing and therefore owns the asserted cover photo.
  const now = new Date();

  assert.deepEqual(rowsOf(await database.query(`
    SELECT column_name AS "columnName", data_type AS "dataType"
      FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'SellerProfilePrivate'
       AND column_name IN (
         'publicMapExactConsentAt',
         'publicMapExactConsentCoordinateHash',
         'publicMapExactConsentVersion'
       )
     ORDER BY column_name
  `)), [
    { columnName: "publicMapExactConsentAt", dataType: "timestamp without time zone" },
    { columnName: "publicMapExactConsentCoordinateHash", dataType: "character varying" },
    { columnName: "publicMapExactConsentVersion", dataType: "integer" },
  ]);
  assert.deepEqual(rowsOf(await database.query(`
    SELECT table_name AS "tableName"
      FROM information_schema.tables
     WHERE table_schema = 'public'
       AND table_name = 'SellerExactMapConsentEvent'
  `)), [{ tableName: "SellerExactMapConsentEvent" }]);
  assert.deepEqual(rowsOf(await database.query(`
    SELECT constraint_row.convalidated AS validated
      FROM pg_catalog.pg_constraint AS constraint_row
     WHERE constraint_row.conrelid = 'public."SellerProfilePrivate"'::regclass
       AND constraint_row.conname = 'SellerProfilePrivate_publicMapExactConsent_check'
  `)), [{ validated: true }]);
  assert.deepEqual(rowsOf(await database.query(`
    SELECT trigger_row.tgenabled AS enabled
      FROM pg_catalog.pg_trigger AS trigger_row
     WHERE trigger_row.tgrelid = 'public."SellerProfile"'::regclass
       AND trigger_row.tgname = 'SellerProfile_exact_map_consent_revoke'
       AND NOT trigger_row.tgisinternal
  `)), [{ enabled: "O" }]);

  const consentFunctions = rowsOf(await database.query(`
    SELECT routine.proname AS name,
           pg_catalog.pg_get_function_identity_arguments(routine.oid) AS arguments,
           routine.prosecdef AS "securityDefiner",
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime',
             routine.oid,
             'EXECUTE'
           ) AS "runtimeExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(
                   routine.proacl,
                   pg_catalog.acldefault('f', routine.proowner)
                 )
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid IN (
       pg_catalog.to_regprocedure('public.grainline_seller_exact_map_consent_revoke()'),
       pg_catalog.to_regprocedure('public.grainline_seller_owner_shop_settings_update(text,text,text,text,double precision,double precision,double precision,boolean,boolean,integer,double precision,double precision,integer,integer,boolean,boolean,text[],text,text,text,text,text,text,text,text,double precision,double precision,double precision,integer)'),
       pg_catalog.to_regprocedure('public.grainline_seller_public_map_points(integer)'),
       pg_catalog.to_regprocedure('public.grainline_seller_public_location(text,text)'),
       pg_catalog.to_regprocedure('public.grainline_seller_public_browse_nearby(double precision,double precision,double precision)')
     )
     ORDER BY routine.proname, arguments
  `));
  assert.equal(consentFunctions.length, 5);
  for (const routine of consentFunctions) {
    assert.equal(routine.securityDefiner, true);
    assert.deepEqual(routine.config, ["search_path=pg_catalog"]);
    assert.equal(routine.publicExecute, false);
    assert.equal(
      routine.runtimeExecute,
      routine.name !== "grainline_seller_exact_map_consent_revoke",
    );
  }

  await database.query(
    `INSERT INTO public."Metro"
      (id, slug, name, state, latitude, longitude, "radiusMiles", "isActive", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full Chain Metro', 'TX', 30.251, -97.749, 45, true, $3, $3)`,
    [metroId, `full-chain-${seller.sellerProfileId}`.slice(0, 100), now],
  );
  await database.query(
    `UPDATE public."SellerProfile"
        SET lat = 30.251,
            lng = -97.749,
            "radiusMeters" = 0,
            "publicMapOptIn" = true,
            "ownerAccountActive" = true,
            "chargesEnabled" = true,
            "stripeAccountSupported" = true,
            "vacationMode" = false,
            "isFoundingMaker" = true,
            "metroId" = $3,
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now, metroId],
  );
  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt", "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Map Viewer', $4, $4, $4, '2026-01-01', $4)`,
    [viewerUserId, viewerClerkId, viewerEmail, now],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", status,
       "isPrivate", "qualityScore", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full Chain Map Listing', 'Public location proof', 1200,
             'ACTIVE', false, 1.2, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Photo"
      (id, "listingId", url, "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://example.test/map-card.jpg', 0, $3)`,
    [photoId, listingId, now],
  );
  await database.query(
    `INSERT INTO public."Review"
      (id, "listingId", "reviewerId", "reviewerAccountActive", "reviewerName",
       "ratingX2", verified, "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, 'Map Viewer', 10, true, $4, $4)`,
    [reviewId, listingId, viewerUserId, now],
  );
  await database.query(
    `INSERT INTO public."ReviewPhoto"
      (id, "reviewId", url, "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://example.test/review.jpg', 0, $3)`,
    [reviewPhotoId, reviewId, now],
  );
  await database.query(
    `INSERT INTO public."BlogPost"
      (id, slug, title, body, "authorId", "authorType", "sellerProfileId", status,
       "authorAccountActive", "publishedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full Chain Seller Story', 'Full-chain blog author proof',
             $3, 'MAKER', $4, 'PUBLISHED', true, $5, $5, $5)`,
    [
      blogPostId,
      `full-chain-story-${seller.sellerProfileId}`.slice(0, 255),
      seller.userId,
      seller.sellerProfileId,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Conversation" (id, "userAId", "userBId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $4)`,
    [conversationId, seller.userId, viewerUserId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `UPDATE public."SellerProfilePrivate"
            SET "publicMapExactConsentAt" = $2,
                "publicMapExactConsentVersion" = 1,
                "publicMapExactConsentCoordinateHash" = repeat('0', 64)
          WHERE "sellerProfileId" = $1`,
        [seller.sellerProfileId, now],
      ),
      (error) => error?.code === "42501",
    );
    await assert.rejects(
      database.query(
        `INSERT INTO public."SellerExactMapConsentEvent"
          (id, "sellerProfileId", "actorUserId", "eventType",
           "consentTextVersion", "consentTextSha256", "coordinateHash",
           reason, "createdAt")
         VALUES ('forged', $1, $2, 'GRANTED', 1, repeat('0', 64),
                 repeat('0', 64), NULL, $3)`,
        [seller.sellerProfileId, seller.userId, now],
      ),
      (error) => error?.code === "42501",
    );
    const rows = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_map_points(500)",
    )).filter((row) => row.id === seller.sellerProfileId);
    assert.deepEqual(rows, [{
      id: seller.sellerProfileId,
      displayName: "Full Chain Workshop",
      city: "Austin",
      state: "TX",
      publicLat: 30.275,
      publicLng: -97.725,
    }]);
    const sellerLocation = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_location($1, NULL)`,
      [seller.sellerProfileId],
    ));
    assert.deepEqual(sellerLocation, [{
      publicLat: 30.275,
      publicLng: -97.725,
      displayRadiusMeters: null,
      structuredGeoEligible: false,
    }]);
    assert.deepEqual(
      Object.keys(sellerLocation[0]).sort(),
      ["displayRadiusMeters", "publicLat", "publicLng", "structuredGeoEligible"].sort(),
    );
    const listingLocation = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_location($1, $2)`,
      [seller.sellerProfileId, listingId],
    ));
    assert.deepEqual(listingLocation, sellerLocation);

    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [viewerUserId],
    );
    await assert.rejects(
      database.query(
        `SELECT public.grainline_seller_owner_shop_settings_update(
           $1, $2, 'Austin', 'TX', 30.251, -97.749, 0,
           true, true, 1, 30.251, -97.749, NULL, NULL, true, false,
           ARRAY[]::text[], NULL, NULL, NULL, NULL, NULL, NULL, 'US', NULL,
           NULL, NULL, NULL, NULL
         )`,
        [seller.userId, seller.sellerProfileId],
      ),
      (error) => error?.code === "42501",
    );
    await database.query("RESET ROLE");
    assert.deepEqual(rowsOf(await database.query(
      `SELECT pg_catalog.count(*)::integer AS count
         FROM public."SellerExactMapConsentEvent"
        WHERE "sellerProfileId" = $1`,
      [seller.sellerProfileId],
    )), [{ count: 0 }]);
    await database.query("SET ROLE grainline_app_runtime");
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [seller.userId],
    );
    await assert.rejects(
      database.query(
        `SELECT public.grainline_seller_owner_shop_settings_update(
           $1, $2, 'Austin', 'TX', 30.251, -97.749, 0,
           true, true, 1, 30.252, -97.749, NULL, NULL, true, false,
           ARRAY[]::text[], NULL, NULL, NULL, NULL, NULL, NULL, 'US', NULL,
           NULL, NULL, NULL, NULL
         )`,
        [seller.userId, seller.sellerProfileId],
      ),
      (error) => error?.code === "22023",
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT public.grainline_seller_owner_shop_settings_update(
         $1, $2, 'Austin', 'TX', 30.251, -97.749, 0,
         true, true, 1, 30.251, -97.749, NULL, NULL, true, false,
         ARRAY[]::text[], NULL, NULL, NULL, NULL, NULL, NULL, 'US', NULL,
         NULL, NULL, NULL, NULL
       ) AS id`,
      [seller.userId, seller.sellerProfileId],
    )), [{ id: seller.sellerProfileId }]);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT public.grainline_seller_owner_shop_settings_update(
         $1, $2, 'Austin', 'TX', 30.251, -97.749, 0,
         true, true, 1, 30.251, -97.749, NULL, NULL, true, false,
         ARRAY[]::text[], NULL, NULL, NULL, NULL, NULL, NULL, 'US', NULL,
         NULL, NULL, NULL, NULL
       ) AS id`,
      [seller.userId, seller.sellerProfileId],
    )), [{ id: seller.sellerProfileId }]);
    await database.query("SELECT pg_catalog.set_config('app.user_id', '', false)");
    await database.query("RESET ROLE");
    assert.deepEqual(rowsOf(await database.query(
      `SELECT "eventType", reason
         FROM public."SellerExactMapConsentEvent"
        WHERE "sellerProfileId" = $1
        ORDER BY "createdAt", id`,
      [seller.sellerProfileId],
    )), [{ eventType: "GRANTED", reason: null }]);
    await assert.rejects(
      database.query(
        `UPDATE public."SellerExactMapConsentEvent"
            SET reason = 'OWNER_ACTION'
          WHERE "sellerProfileId" = $1`,
        [seller.sellerProfileId],
      ),
      (error) => error?.code === "55000",
    );
    await database.query("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "publicLat", "publicLng"
           FROM public.grainline_seller_public_map_points(500)
          WHERE id = $1`,
        [seller.sellerProfileId],
      )),
      [{ publicLat: 30.251, publicLng: -97.749 }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT *
           FROM public.grainline_seller_public_location($1, NULL)`,
        [seller.sellerProfileId],
      )),
      [{
        publicLat: 30.251,
        publicLng: -97.749,
        displayRadiusMeters: null,
        structuredGeoEligible: true,
      }],
    );
    await database.query("RESET ROLE");
    await database.query(
      `UPDATE public."SellerProfile"
          SET lat = 30.252
        WHERE id = $1`,
      [seller.sellerProfileId],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "publicMapExactConsentAt", "publicMapExactConsentVersion",
                "publicMapExactConsentCoordinateHash"
           FROM public."SellerProfilePrivate"
          WHERE "sellerProfileId" = $1`,
        [seller.sellerProfileId],
      )),
      [{
        publicMapExactConsentAt: null,
        publicMapExactConsentVersion: null,
        publicMapExactConsentCoordinateHash: null,
      }],
    );
    assert.deepEqual(rowsOf(await database.query(
      `SELECT "eventType", reason
         FROM public."SellerExactMapConsentEvent"
        WHERE "sellerProfileId" = $1
        ORDER BY "createdAt", id`,
      [seller.sellerProfileId],
    )), [
      { eventType: "GRANTED", reason: null },
      { eventType: "WITHDRAWN", reason: "LOCATION_CHANGE" },
    ]);
    await database.query(
      `UPDATE public."SellerProfile"
          SET lat = 30.251
        WHERE id = $1`,
      [seller.sellerProfileId],
    );
    await database.query("SET ROLE grainline_app_runtime");
    const browseSellerIds = rowsOf(await database.query(
      `SELECT "sellerProfileId"
         FROM public.grainline_seller_public_browse_nearby(30.251, -97.749, 25)`,
    ));
    assert.equal(
      browseSellerIds.some((row) => row.sellerProfileId === seller.sellerProfileId),
      true,
    );
    const nameSuggestions = rowsOf(await database.query(
      `SELECT id, "displayName"
         FROM public.grainline_seller_public_name_suggestions(
           'Full Chain',
           'full chain',
           true,
           10
         )`,
    ));
    assert.deepEqual(nameSuggestions, [{
      id: seller.sellerProfileId,
      displayName: "Full Chain Workshop",
    }]);
    const sitemapCounts = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_sitemap_counts()",
    ));
    assert.equal(Number(sitemapCounts[0].sellerCount) >= 1, true);
    assert.equal(Number(sitemapCounts[0].customerPhotoSellerCount) >= 1, true);
    const marketplaceCounts = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_marketplace_counts()",
    ));
    assert.equal(Number(marketplaceCounts[0].activeSellerCount) >= 1, true);
    assert.equal(Number(marketplaceCounts[0].foundingMakerCount) >= 1, true);
    const listingTags = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_listing_tags(200)",
    ));
    assert.equal(listingTags.every((row) => typeof row.tag === "string"), true);
    const blogTags = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_blog_tags(200)",
    ));
    assert.equal(blogTags.every((row) => typeof row.tag === "string"), true);
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_listing_tags(201)"),
      (error) => error?.code === "22023",
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_blog_tags(201)"),
      (error) => error?.code === "22023",
    );
    const metroCount = rowsOf(await database.query(
      `SELECT public.grainline_seller_public_metro_count($1, true, true) AS value`,
      [metroId],
    ));
    assert.equal(Number(metroCount[0].value) >= 1, true);
    const metroStaticSlugs = rowsOf(await database.query(
      "SELECT slug FROM public.grainline_seller_public_metro_static_slugs()",
    ));
    assert.equal(
      metroStaticSlugs.some((row) => row.slug === `full-chain-${seller.sellerProfileId}`.slice(0, 100)),
      true,
    );
    const metroMakers = rowsOf(await database.query(
      `SELECT id, "displayName", "coverImageUrl", "activeListingCount"
         FROM public.grainline_seller_public_metro_makers($1, true, 24)`,
      [metroId],
    ));
    const provedMetroMakers = metroMakers
      .filter((row) => row.id === seller.sellerProfileId)
      .map((row) => ({
        id: row.id,
        displayName: row.displayName,
        coverImageUrl: row.coverImageUrl,
        activeListingCount: Number(row.activeListingCount),
      }));
    assert.equal(provedMetroMakers.length, 1);
    assert.equal(provedMetroMakers[0].id, seller.sellerProfileId);
    assert.equal(provedMetroMakers[0].displayName, "Full Chain Workshop");
    assert.equal(provedMetroMakers[0].coverImageUrl, "https://example.test/map-card.jpg");
    assert.equal(provedMetroMakers[0].activeListingCount >= 1, true);
    assert.deepEqual(
      rowsOf(await database.query(
        "SELECT * FROM public.grainline_seller_public_nearby_metros($1)",
        [metroId],
      )),
      [],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        "SELECT slug, name, state FROM public.grainline_seller_public_footer_metros()",
      )).filter((row) => row.slug === `full-chain-${seller.sellerProfileId}`.slice(0, 100)),
      [{
        slug: `full-chain-${seller.sellerProfileId}`.slice(0, 100),
        name: "Full Chain Metro",
        state: "TX",
      }],
    );
    const similarMakers = rowsOf(await database.query(
      `SELECT id, "scopeKind"
         FROM public.grainline_seller_public_similar_makers($1, 4)`,
      [listingId],
    ));
    assert.equal(similarMakers.length <= 4, true);
    assert.equal(
      similarMakers.every((row) => row.id !== seller.sellerProfileId),
      true,
    );
    const featuredMakers = rowsOf(await database.query(
      "SELECT id FROM public.grainline_seller_public_featured_makers()",
    ));
    assert.equal(featuredMakers.length <= 2, true);
    assert.equal(
      new Set(featuredMakers.map((row) => row.id)).size,
      featuredMakers.length,
    );
    const mapCard = rowsOf(await database.query(
      `SELECT id, "displayName", "coverImageUrl"
         FROM public.grainline_seller_public_map_card($1)`,
      [seller.sellerProfileId],
    ));
    assert.deepEqual(mapCard, [{
      id: seller.sellerProfileId,
      displayName: "Full Chain Workshop",
      coverImageUrl: "https://example.test/map-card.jpg",
    }]);
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId", "followerCount", following
           FROM public.grainline_seller_public_follow_state($1)`,
        [seller.sellerProfileId],
      )).map((row) => ({
        ...row,
        followerCount: Number(row.followerCount),
      })),
      [{
        sellerProfileId: seller.sellerProfileId,
        followerCount: 0,
        following: false,
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "ownerUserId"
           FROM public.grainline_seller_public_view_target($1)`,
        [seller.sellerProfileId],
      )),
      [{ ownerUserId: seller.userId }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT id, "userId", "displayName", tagline
           FROM public.grainline_seller_public_blog_author($1)`,
        [seller.sellerProfileId],
      )),
      [{
        id: seller.sellerProfileId,
        userId: seller.userId,
        displayName: "Full Chain Workshop",
        tagline: null,
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT id, "userId", "displayName", "publicPhotosEligible"
           FROM public.grainline_seller_public_customer_photo_header($1)`,
        [seller.sellerProfileId],
      )),
      [{
        id: seller.sellerProfileId,
        userId: seller.userId,
        displayName: "Full Chain Workshop",
        publicPhotosEligible: true,
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT public.grainline_seller_public_report_target($1, $2) AS value`,
        [seller.sellerProfileId, seller.userId],
      )),
      [{ value: true }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT public.grainline_seller_public_report_target($1, $2) AS value`,
        [seller.sellerProfileId, viewerUserId],
      )),
      [{ value: false }],
    );
    const sellerSitemapRows = rowsOf(await database.query(
      `SELECT id, "displayName"
         FROM public.grainline_seller_public_sitemap_page('SELLERS', 0, 50000)`,
    ));
    assert.deepEqual(
      sellerSitemapRows.filter((row) => row.id === seller.sellerProfileId),
      [{ id: seller.sellerProfileId, displayName: "Full Chain Workshop" }],
    );
    const customerPhotoSitemapRows = rowsOf(await database.query(
      `SELECT id, "displayName"
         FROM public.grainline_seller_public_sitemap_page(
           'CUSTOMER_PHOTOS',
           0,
           50000
         )`,
    ));
    assert.deepEqual(
      customerPhotoSitemapRows.filter((row) => row.id === seller.sellerProfileId),
      [{ id: seller.sellerProfileId, displayName: "Full Chain Workshop" }],
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `UPDATE public."User" SET banned = true WHERE id = $1`,
    [viewerUserId],
  );
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [viewerUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_map_points(500)"),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("SELECT pg_catalog.set_config('app.user_id', '', false)");
    await database.query(
      `UPDATE public."User" SET banned = false WHERE id = $1`,
      [viewerUserId],
    );
  }

  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [seller.userId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const accountSummary = rowsOf(await database.query(
        `SELECT "sellerProfileId", "avatarImageUrl", "activeListingCount"
           FROM public.grainline_seller_owner_account_summary()`,
      )).map((row) => ({
        ...row,
        activeListingCount: Number(row.activeListingCount),
      }));
    assert.equal(accountSummary.length, 1);
    assert.equal(accountSummary[0].sellerProfileId, seller.sellerProfileId);
    assert.equal(accountSummary[0].avatarImageUrl, null);
    assert.equal(accountSummary[0].activeListingCount >= 1, true);
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId", "displayName", "createdAtEpochMillis",
                "chargesEnabled", "vacationMode"
           FROM public.grainline_seller_owner_core()`,
      )).map((row) => ({
        ...row,
        createdAtEpochMillis: Number(row.createdAtEpochMillis),
      })),
      [{
        sellerProfileId: seller.sellerProfileId,
        displayName: "Full Chain Workshop",
        createdAtEpochMillis: Date.parse("2026-10-15T00:00:00.000Z"),
        chargesEnabled: true,
        vacationMode: false,
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId", "guildLevel", "vacationMode",
                "vacationReturnEpochMillis", "chargesEnabled"
           FROM public.grainline_seller_owner_dashboard_state()`,
      )),
      [{
        sellerProfileId: seller.sellerProfileId,
        guildLevel: "NONE",
        vacationMode: false,
        vacationReturnEpochMillis: null,
        chargesEnabled: true,
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId", "listingId", "listingTitle"
           FROM public.grainline_seller_owner_blog_editor()`,
      )).filter((row) => row.listingId === listingId),
      [{
        sellerProfileId: seller.sellerProfileId,
        listingId,
        listingTitle: "Full Chain Map Listing",
      }],
    );
    const listingReview = rowsOf(await database.query(
      `SELECT "sellerProfileId", "displayName", "totalListingCount"
         FROM public.grainline_seller_owner_listing_review()`,
    )).map((row) => ({
      ...row,
      totalListingCount: Number(row.totalListingCount),
    }));
    assert.equal(listingReview.length, 1);
    assert.equal(listingReview[0].sellerProfileId, seller.sellerProfileId);
    assert.equal(listingReview[0].displayName, "Full Chain Workshop");
    assert.equal(listingReview[0].totalListingCount >= 1, true);
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId", lat, lng
           FROM public.grainline_seller_owner_listing_metro_source($1)`,
        [seller.sellerProfileId],
      )),
      [{
        sellerProfileId: seller.sellerProfileId,
        lat: 30.251,
        lng: -97.749,
      }],
    );
    const publishReview = rowsOf(await database.query(
      `SELECT "sellerProfileId", "displayName", "chargesEnabled",
              "vacationMode", "publishReviewListingCount"
         FROM public.grainline_seller_owner_listing_publish_review($1)`,
      [seller.sellerProfileId],
    )).map((row) => ({
      ...row,
      publishReviewListingCount: Number(row.publishReviewListingCount),
    }));
    assert.equal(publishReview.length, 1);
    assert.equal(publishReview[0].sellerProfileId, seller.sellerProfileId);
    assert.equal(publishReview[0].displayName, "Full Chain Workshop");
    assert.equal(publishReview[0].chargesEnabled, true);
    assert.equal(publishReview[0].vacationMode, false);
    assert.equal(publishReview[0].publishReviewListingCount >= 1, true);
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId"
           FROM public.grainline_seller_owner_vacation_update($1, true, $2, $3)`,
        [seller.sellerProfileId, BigInt(Date.parse("2026-11-02T12:00:00.000Z")), "Back soon"],
      )),
      [{ sellerProfileId: seller.sellerProfileId }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId"
           FROM public.grainline_seller_owner_vacation_update($1, false, NULL, NULL)`,
        [seller.sellerProfileId],
      )),
      [{ sellerProfileId: seller.sellerProfileId }],
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [viewerUserId],
  );
  const followInitialTimeZone = rowsOf(await database.query(
    "SELECT pg_catalog.current_setting('TimeZone') AS timezone",
  ))[0].timezone;
  await database.query(
    "SELECT pg_catalog.set_config('TimeZone', 'America/Los_Angeles', false)",
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId", "userId", "displayName", "acceptsCustomOrders",
                "chargesEnabled", "stripeAccountSupported"
           FROM public.grainline_seller_actor_conversation_cards(ARRAY[$1]::text[])`,
        [seller.userId],
      )),
      [{
        sellerProfileId: seller.sellerProfileId,
        userId: seller.userId,
        displayName: "Full Chain Workshop",
        acceptsCustomOrders: false,
        chargesEnabled: true,
        stripeAccountSupported: true,
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "resultStatus", "ownerUserId", created, "followerCount"
           FROM public.grainline_seller_public_follow_create($1, $2)`,
        [seller.sellerProfileId, followId],
      )).map((row) => ({
        ...row,
        followerCount: Number(row.followerCount),
      })),
      [{
        resultStatus: "OK",
        ownerUserId: seller.userId,
        created: true,
        followerCount: 1,
      }],
    );
    const followTimestamp = rowsOf(await database.query(
      `SELECT ABS(EXTRACT(
                epoch FROM (
                  follower."createdAt" -
                  (pg_catalog.clock_timestamp() AT TIME ZONE 'UTC')
                )
              ))::double precision AS "utcDriftSeconds"
         FROM public."Follow" AS follower
        WHERE follower.id = $1`,
      [followId],
    ));
    assert.equal(followTimestamp.length, 1);
    assert.equal(followTimestamp[0].utcDriftSeconds < 15, true);
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "resultStatus", "ownerUserId", created, "followerCount"
           FROM public.grainline_seller_public_follow_create($1, $2)`,
        [seller.sellerProfileId, `${followId}_replay`],
      )).map((row) => ({
        ...row,
        followerCount: Number(row.followerCount),
      })),
      [{
        resultStatus: "OK",
        ownerUserId: seller.userId,
        created: false,
        followerCount: 1,
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId", "followerCount", following
           FROM public.grainline_seller_public_follow_state($1)`,
        [seller.sellerProfileId],
      )).map((row) => ({
        ...row,
        followerCount: Number(row.followerCount),
      })),
      [{
        sellerProfileId: seller.sellerProfileId,
        followerCount: 1,
        following: true,
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT id, "displayName", "guildLevel"
           FROM public.grainline_seller_actor_account_feed_cards(ARRAY[$1]::text[])`,
        [seller.sellerProfileId],
      )),
      [{
        id: seller.sellerProfileId,
        displayName: "Full Chain Workshop",
        guildLevel: "NONE",
      }],
    );
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "resultStatus", "followerCount"
           FROM public.grainline_seller_public_follow_delete($1)`,
        [seller.sellerProfileId],
      )).map((row) => ({
        ...row,
        followerCount: Number(row.followerCount),
      })),
      [{ resultStatus: "OK", followerCount: 0 }],
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
    await database.query(
      "SELECT pg_catalog.set_config('TimeZone', $1, false)",
      [followInitialTimeZone],
    );
  }

  await database.query(
    `UPDATE public."Listing"
        SET "isPrivate" = true,
            "reservedForUserId" = $2,
            "updatedAt" = $3
      WHERE id = $1`,
    [listingId, viewerUserId, now],
  );
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [viewerUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const rows = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_location($1, $2)`,
      [seller.sellerProfileId, listingId],
    ));
    assert.equal(rows.length, 1);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }
  await database.query(
    `UPDATE public."Listing"
        SET "isPrivate" = false,
            "reservedForUserId" = NULL,
            "updatedAt" = $2
      WHERE id = $1`,
    [listingId, now],
  );

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, seller.userId, viewerUserId, now],
  );
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [viewerUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    const rows = rowsOf(await database.query(
      "SELECT id FROM public.grainline_seller_public_map_points(500) WHERE id = $1",
      [seller.sellerProfileId],
    ));
    assert.deepEqual(rows, []);
    const locationRows = rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_location($1, NULL)`,
      [seller.sellerProfileId],
    ));
    assert.deepEqual(locationRows, []);
    const browseSellerIds = rowsOf(await database.query(
      `SELECT "sellerProfileId"
         FROM public.grainline_seller_public_browse_nearby(30.251, -97.749, 25)`,
    ));
    assert.equal(
      browseSellerIds.some((row) => row.sellerProfileId === seller.sellerProfileId),
      false,
    );
    const nameSuggestions = rowsOf(await database.query(
      `SELECT id
         FROM public.grainline_seller_public_name_suggestions(
           'Full Chain',
           'full chain',
           true,
           10
         )`,
    ));
    assert.deepEqual(nameSuggestions, []);
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT id
           FROM public.grainline_seller_public_metro_makers($1, true, 24)`,
        [metroId],
      )),
      [],
    );
    assert.equal(
      rowsOf(await database.query(
        `SELECT "resultStatus"
           FROM public.grainline_seller_public_follow_create($1, $2)`,
        [seller.sellerProfileId, `${followId}_blocked`],
      ))[0].resultStatus,
      "BLOCKED",
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  // The full-chain role bootstrap intentionally creates only reviewed runtime
  // roles. Use the existing staff-read role as the non-grantee principal.
  await database.query("SET ROLE grainline_staff_read_runtime");
  try {
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_map_points(500)"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_sitemap_counts()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_marketplace_counts()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_blog_author('target')"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_customer_photo_header('target')",
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_actor_conversation_cards(ARRAY['target']::text[])",
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_actor_account_feed_cards(ARRAY['target']::text[])",
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_account_summary()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_core()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_dashboard_state()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_blog_editor()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_listing_review()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_vacation_update('seller', false, NULL, NULL)",
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_metro_source($1)",
        [seller.sellerProfileId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_listing_publish_review($1)",
        [seller.sellerProfileId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT public.grainline_seller_public_metro_count($1, true, true)",
        [metroId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_follow_state($1)",
        [seller.sellerProfileId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_follow_create($1, $2)",
        [seller.sellerProfileId, `${followId}_untrusted`],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_follow_delete($1)",
        [seller.sellerProfileId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_metro_static_slugs()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_footer_metros()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_metro_makers($1, true, 24)",
        [metroId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_nearby_metros($1)",
        [metroId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_similar_makers($1, 4)",
        [listingId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_featured_makers()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_map_card($1)",
        [seller.sellerProfileId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_view_target($1)",
        [seller.sellerProfileId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_sitemap_page('SELLERS', 0, 1)",
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_location($1, NULL)",
        [seller.sellerProfileId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_browse_nearby(30, -97, 25)",
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_public_name_suggestions(
             'Full Chain',
             'full chain',
             true,
             10
           )`,
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE").catch(() => {});
  }
}
