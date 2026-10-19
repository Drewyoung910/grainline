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
  const metroId = `${seller.sellerProfileId}_public_metro`;
  const now = new Date("2026-10-19T00:00:00.000Z");

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
       "isPrivate", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full Chain Map Listing', 'Public location proof', 1200,
             'ACTIVE', false, $3, $3)`,
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

  await database.query("SET ROLE grainline_app_runtime");
  try {
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
      structuredGeoEligible: true,
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
    assert.deepEqual(
      metroMakers.filter((row) => row.id === seller.sellerProfileId).map((row) => ({
        id: row.id,
        displayName: row.displayName,
        coverImageUrl: row.coverImageUrl,
        activeListingCount: Number(row.activeListingCount),
      })),
      [{
        id: seller.sellerProfileId,
        displayName: "Full Chain Workshop",
        coverImageUrl: "https://example.test/map-card.jpg",
        activeListingCount: 1,
      }],
    );
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
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [seller.userId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT "sellerProfileId", "avatarImageUrl", "activeListingCount"
           FROM public.grainline_seller_owner_account_summary()`,
      )).map((row) => ({
        ...row,
        activeListingCount: Number(row.activeListingCount),
      })),
      [{
        sellerProfileId: seller.sellerProfileId,
        avatarImageUrl: null,
        activeListingCount: 1,
      }],
    );
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
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [viewerUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
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

  await database.query("SET ROLE grainline_untrusted");
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
      database.query("SELECT * FROM public.grainline_seller_owner_account_summary()"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_owner_core()"),
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
