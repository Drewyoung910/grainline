import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function inspectAsOwner(database, operation) {
  await database.query("RESET ROLE");
  try {
    return await operation();
  } finally {
    await database.query("SET ROLE grainline_app_runtime");
  }
}

async function rejectsAtSavepoint(database, name, operation, pattern) {
  await database.query(`SAVEPOINT ${name}`);
  try {
    await assert.rejects(operation(), pattern);
  } finally {
    await database.query(`ROLLBACK TO SAVEPOINT ${name}`);
    await database.query(`RELEASE SAVEPOINT ${name}`);
  }
}

const updateSql = `
  SELECT *
    FROM public.grainline_seller_owner_profile_update(
      $1::text, $2::text, $3::text, $4::text, $5::text, $6::text,
      $7::text, $8::integer, $9::text, $10::text, $11::text,
      $12::text[], $13::text[], $14::boolean, $15::text, $16::text,
      $17::text, $18::text, $19::text, $20::text, $21::text, $22::text,
      $23::boolean, $24::boolean, $25::integer, $26::boolean, $27::integer
    )
`;

function updateArgs(sellerProfileId, overrides = {}) {
  const input = {
    displayName: "Updated Full Chain Workshop",
    displayNameNormalized: "updated full chain workshop",
    tagline: "Editor tagline",
    bio: "Editor bio",
    storyTitle: "Editor story",
    storyBody: "Editor story body",
    yearsInBusiness: 12,
    bannerImageUrl: "https://cdn.example.test/banner.jpg",
    avatarImageUrl: "https://cdn.example.test/avatar.jpg",
    workshopImageUrl: "https://cdn.example.test/workshop.jpg",
    galleryImageUrls: ["https://cdn.example.test/gallery-1.jpg"],
    galleryAltTexts: ["Gallery one"],
    galleryImagesTouched: true,
    instagramUrl: "https://instagram.com/full-chain",
    facebookUrl: "https://facebook.com/full-chain",
    pinterestUrl: "https://pinterest.com/full-chain",
    tiktokUrl: "https://tiktok.com/@full-chain",
    websiteUrl: "https://full-chain.example.test/",
    returnPolicy: "Returns accepted.",
    customOrderPolicy: "Custom orders accepted.",
    shippingPolicy: "Ships promptly.",
    acceptsCustomOrders: true,
    acceptingNewOrders: false,
    customOrderTurnaroundDays: 45,
    offersGiftWrapping: true,
    giftWrappingPriceCents: 500,
    ...overrides,
  };
  return [
    sellerProfileId,
    input.displayName,
    input.displayNameNormalized,
    input.tagline,
    input.bio,
    input.storyTitle,
    input.storyBody,
    input.yearsInBusiness,
    input.bannerImageUrl,
    input.avatarImageUrl,
    input.workshopImageUrl,
    input.galleryImageUrls,
    input.galleryAltTexts,
    input.galleryImagesTouched,
    input.instagramUrl,
    input.facebookUrl,
    input.pinterestUrl,
    input.tiktokUrl,
    input.websiteUrl,
    input.returnPolicy,
    input.customOrderPolicy,
    input.shippingPolicy,
    input.acceptsCustomOrders,
    input.acceptingNewOrders,
    input.customOrderTurnaroundDays,
    input.offersGiftWrapping,
    input.giftWrappingPriceCents,
  ];
}

export async function proveSellerProfileOwnerProfileEditor({ database, seller }) {
  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
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
     WHERE routine.oid IN (
       pg_catalog.to_regprocedure(
         'public.grainline_seller_owner_profile_editor_state(text)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_owner_profile_update(text,text,text,text,text,text,text,integer,text,text,text,text[],text[],boolean,text,text,text,text,text,text,text,text,boolean,boolean,integer,boolean,integer)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_seller_owner_profile_editor_state",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
    {
      name: "grainline_seller_owner_profile_update",
      securityDefiner: true,
      volatility: "v",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      staffExecute: false,
      publicExecute: false,
    },
  ]);

  const duplicateUserId = `${seller.userId}_profile_duplicate`;
  const duplicateSellerProfileId = `${seller.sellerProfileId}_profile_duplicate`;
  const faqId = `${seller.sellerProfileId}_profile_faq`;
  const now = new Date("2026-10-20T20:00:00.000Z");

  await database.query("BEGIN");
  try {
    await database.query(
      `INSERT INTO public."User"
        (id, "clerkId", email, name, "createdAt", "updatedAt",
         "termsAcceptedAt", "termsVersion", "ageAttestedAt")
       VALUES ($1, $2, $3, 'Duplicate Seller', $4, $4, $4, '2026-01-01', $4)`,
      [
        duplicateUserId,
        `user_${duplicateUserId}`,
        `${duplicateUserId}@example.test`,
        now,
      ],
    );
    await database.query(
      `INSERT INTO public."SellerProfile"
        (id, "userId", "displayName", "displayNameNormalized", "createdAt", "updatedAt")
       VALUES ($1, $2, 'Duplicate Studio', 'duplicate studio', $3, $3)`,
      [duplicateSellerProfileId, duplicateUserId, now],
    );
    await database.query(
      `INSERT INTO public."SellerFaq"
        (id, "sellerProfileId", question, answer, "sortOrder", "createdAt")
       VALUES ($1, $2, 'Editor question?', 'Editor answer.', 2, $3)`,
      [faqId, seller.sellerProfileId, now],
    );

    const [expectedProfileState] = rowsOf(await database.query(
      `SELECT seller."avatarImageUrl",
              seller."bannerImageUrl",
              seller."displayName",
              seller.tagline,
              seller."yearsInBusiness",
              seller.bio,
              seller."storyTitle",
              seller."storyBody",
              seller."workshopImageUrl",
              seller."galleryImageUrls",
              seller."galleryAltTexts",
              seller."instagramUrl",
              seller."facebookUrl",
              seller."pinterestUrl",
              seller."tiktokUrl",
              seller."websiteUrl",
              seller."returnPolicy",
              seller."customOrderPolicy",
              seller."shippingPolicy",
              seller."acceptsCustomOrders",
              seller."acceptingNewOrders",
              seller."customOrderTurnaroundDays",
              seller."offersGiftWrapping",
              seller."giftWrappingPriceCents",
              seller."featuredListingIds"
         FROM public."SellerProfile" AS seller
        WHERE seller.id = $1`,
      [seller.sellerProfileId],
    ));
    const expectedFaqs = rowsOf(await database.query(
      `SELECT faq.id, faq.question, faq.answer
         FROM public."SellerFaq" AS faq
        WHERE faq."sellerProfileId" = $1
        ORDER BY faq."sortOrder", faq.id`,
      [seller.sellerProfileId],
    ));
    const expectedEditorState = [{
      sellerProfileId: seller.sellerProfileId,
      state: { ...expectedProfileState, faqs: expectedFaqs },
    }];

    await database.query("SET ROLE grainline_app_runtime");
    try {
      await rejectsAtSavepoint(
        database,
        "profile_state_context",
        () => database.query(
          `SELECT * FROM public.grainline_seller_owner_profile_editor_state($1)`,
          [seller.sellerProfileId],
        ),
        /context is invalid/u,
      );
      await rejectsAtSavepoint(
        database,
        "profile_update_context",
        () => database.query(updateSql, updateArgs(seller.sellerProfileId)),
        /context is invalid/u,
      );

      await database.query(
        `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
        [`${seller.userId}_other`],
      );
      assert.deepEqual(rowsOf(await database.query(
        `SELECT * FROM public.grainline_seller_owner_profile_editor_state($1)`,
        [seller.sellerProfileId],
      )), []);
      assert.deepEqual(rowsOf(await database.query(
        updateSql,
        updateArgs(seller.sellerProfileId, { displayName: "Wrong actor" }),
      )), []);

      await database.query(
        `SELECT pg_catalog.set_config('app.user_id', $1, false)`,
        [seller.userId],
      );
      assert.deepEqual(rowsOf(await database.query(
        `SELECT * FROM public.grainline_seller_owner_profile_editor_state($1)`,
        [seller.sellerProfileId],
      )), expectedEditorState);

      assert.deepEqual(rowsOf(await database.query(
        updateSql,
        updateArgs(seller.sellerProfileId, {
          displayName: "duplicate studio",
          displayNameNormalized: "DUPLICATE STUDIO",
          offersGiftWrapping: false,
          giftWrappingPriceCents: 500,
        }),
      )), [{ sellerProfileId: seller.sellerProfileId, duplicateDisplayName: true }]);

      assert.deepEqual(rowsOf(await inspectAsOwner(database, () => database.query(
        `SELECT "displayName", "displayNameNormalized", tagline, bio,
                "yearsInBusiness", "galleryImageUrls", "galleryAltTexts",
                "acceptsCustomOrders", "acceptingNewOrders",
                "customOrderTurnaroundDays", "offersGiftWrapping",
                "giftWrappingPriceCents"
           FROM public."SellerProfile"
          WHERE id = $1`,
        [seller.sellerProfileId],
      ))), [{
        displayName: "duplicate studio",
        displayNameNormalized: "DUPLICATE STUDIO",
        tagline: "Editor tagline",
        bio: "Editor bio",
        yearsInBusiness: 12,
        galleryImageUrls: ["https://cdn.example.test/gallery-1.jpg"],
        galleryAltTexts: ["Gallery one"],
        acceptsCustomOrders: true,
        acceptingNewOrders: false,
        customOrderTurnaroundDays: 45,
        offersGiftWrapping: false,
        giftWrappingPriceCents: null,
      }]);

      assert.deepEqual(rowsOf(await database.query(
        updateSql,
        updateArgs(seller.sellerProfileId, {
          displayName: "Unique Updated Studio",
          displayNameNormalized: "unique updated studio",
          galleryImageUrls: [],
          galleryAltTexts: [],
          galleryImagesTouched: false,
        }),
      )), [{ sellerProfileId: seller.sellerProfileId, duplicateDisplayName: false }]);
      assert.deepEqual(rowsOf(await inspectAsOwner(database, () => database.query(
        `SELECT "galleryImageUrls", "galleryAltTexts", "giftWrappingPriceCents"
           FROM public."SellerProfile"
          WHERE id = $1`,
        [seller.sellerProfileId],
      ))), [{
        galleryImageUrls: ["https://cdn.example.test/gallery-1.jpg"],
        galleryAltTexts: ["Gallery one"],
        giftWrappingPriceCents: 500,
      }]);

      await rejectsAtSavepoint(
        database,
        "profile_update_bounds",
        () => database.query(
          updateSql,
          updateArgs(seller.sellerProfileId, { yearsInBusiness: 201 }),
        ),
        /value is out of bounds/u,
      );
    } finally {
      await database.query("RESET ROLE");
      await database.query("RESET app.user_id");
    }
  } finally {
    await database.query("ROLLBACK");
  }
}
