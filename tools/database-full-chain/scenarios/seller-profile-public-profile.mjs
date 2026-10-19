import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicProfileAuthority({ database, seller }) {
  const viewerUserId = `${seller.userId}_profile_viewer`;
  const blockedViewerUserId = `${seller.userId}_profile_blocked`;
  const bannedViewerUserId = `${seller.userId}_profile_banned`;
  const metroId = `${seller.sellerProfileId}_profile_metro`;
  const cityMetroId = `${seller.sellerProfileId}_profile_city_metro`;
  const faqFirstId = `${seller.sellerProfileId}_faq_first`;
  const faqSecondId = `${seller.sellerProfileId}_faq_second`;
  const blockId = `${seller.sellerProfileId}_profile_block`;
  const now = new Date("2026-10-19T12:00:00.000Z");

  const functionRows = rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
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
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_seller_public_profile(text)'
     )
  `));
  assert.deepEqual(functionRows, [{
    securityDefiner: true,
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    publicExecute: false,
  }]);

  for (const [userId, suffix, banned] of [
    [viewerUserId, "viewer", false],
    [blockedViewerUserId, "blocked", false],
    [bannedViewerUserId, "banned", true],
  ]) {
    await database.query(
      `INSERT INTO public."User"
        (id, "clerkId", email, name, banned, "createdAt", "updatedAt",
         "termsAcceptedAt", "termsVersion", "ageAttestedAt")
       VALUES ($1, $2, $3, $4, $5, $6, $6, $6, '2026-01-01', $6)`,
      [
        userId,
        `user_full_chain_profile_${suffix}_${seller.userId}`,
        `profile-${suffix}-${seller.userId}@example.test`,
        `Profile ${suffix}`,
        banned,
        now,
      ],
    );
  }
  await database.query(
    `INSERT INTO public."Metro"
      (id, slug, name, state, latitude, longitude, "radiusMiles", "isActive",
       "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'Profile Metro', 'TX', 30.25, -97.75, 45, true, $5, $5),
       ($3, $4, 'Profile City Metro', 'TX', 30.26, -97.74, 20, true, $5, $5)`,
    [
      metroId,
      `profile-metro-${seller.sellerProfileId}`.slice(0, 100),
      cityMetroId,
      `profile-city-${seller.sellerProfileId}`.slice(0, 100),
      now,
    ],
  );
  await database.query(
    `UPDATE public."SellerProfile"
        SET bio = 'Full public biography',
            tagline = 'Built for the full-chain proof',
            "storyTitle" = 'Our shop story',
            "storyBody" = 'A bounded public profile',
            "acceptsCustomOrders" = true,
            "returnPolicy" = 'Returns accepted',
            "featuredListingIds" = ARRAY['profile_listing_one', 'profile_listing_two']::text[],
            "galleryImageUrls" = ARRAY['https://example.test/gallery.jpg']::text[],
            "galleryAltTexts" = ARRAY['Workshop detail']::text[],
            "guildLevel" = 'GUILD_MEMBER',
            "isFoundingMaker" = true,
            "foundingMakerNumber" = 42,
            "metroId" = $2,
            "cityMetroId" = $3,
            "ownerAccountActive" = true,
            "chargesEnabled" = true,
            "stripeAccountSupported" = true,
            "updatedAt" = $4
      WHERE id = $1`,
    [seller.sellerProfileId, metroId, cityMetroId, now],
  );
  await database.query(
    `INSERT INTO public."SellerFaq"
      (id, "sellerProfileId", question, answer, "sortOrder", "createdAt")
     VALUES
       ($1, $3, 'Second question', 'Second answer', 20, $4),
       ($2, $3, 'First question', 'First answer', 10, $4)`,
    [faqSecondId, faqFirstId, seller.sellerProfileId, now],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    const anonymousRows = rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_public_profile($1)`,
      [seller.sellerProfileId],
    ));
    assert.equal(anonymousRows.length, 1);
    assert.equal(anonymousRows[0].id, seller.sellerProfileId);
    assert.equal(anonymousRows[0].displayName, "Full Chain Workshop");
    assert.equal(anonymousRows[0].viewerIsOwner, false);
    assert.deepEqual(anonymousRows[0].faqs, [
      { id: faqFirstId, question: "First question", answer: "First answer" },
      { id: faqSecondId, question: "Second question", answer: "Second answer" },
    ]);
    assert.deepEqual(anonymousRows[0].metro, {
      slug: `profile-metro-${seller.sellerProfileId}`.slice(0, 100),
      name: "Profile Metro",
      state: "TX",
    });
    assert.deepEqual(anonymousRows[0].cityMetro, {
      slug: `profile-city-${seller.sellerProfileId}`.slice(0, 100),
      name: "Profile City Metro",
      state: "TX",
    });
    for (const forbiddenKey of [
      "userId",
      "lat",
      "lng",
      "radiusMeters",
      "publicMapOptIn",
      "chargesEnabled",
      "stripeAccountSupported",
      "ownerAccountActive",
      "publicMapExactConsentAt",
      "publicMapExactConsentVersion",
    ]) {
      assert.equal(forbiddenKey in anonymousRows[0], false, forbiddenKey);
    }
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [viewerUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.equal(
      rowsOf(await database.query(
        `SELECT "viewerIsOwner"
           FROM public.grainline_seller_public_profile($1)`,
        [seller.sellerProfileId],
      ))[0]?.viewerIsOwner,
      false,
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, blockedViewerUserId, seller.userId, now],
  );
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [blockedViewerUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT id FROM public.grainline_seller_public_profile($1)`,
        [seller.sellerProfileId],
      )),
      [],
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query(
    `UPDATE public."SellerProfile"
        SET "chargesEnabled" = false,
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(
      rowsOf(await database.query(
        `SELECT id FROM public.grainline_seller_public_profile($1)`,
        [seller.sellerProfileId],
      )),
      [],
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
        `SELECT id, "viewerIsOwner"
           FROM public.grainline_seller_public_profile($1)`,
        [seller.sellerProfileId],
      )),
      [{ id: seller.sellerProfileId, viewerIsOwner: true }],
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [bannedViewerUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT id FROM public.grainline_seller_public_profile($1)`,
        [seller.sellerProfileId],
      ),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  // Restore shared fixture state for the independent scenarios that follow.
  await database.query(`DELETE FROM public."Block" WHERE id = $1`, [blockId]);
  await database.query(
    `UPDATE public."SellerProfile"
        SET "chargesEnabled" = true,
            "foundingMakerNumber" = NULL,
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
}
