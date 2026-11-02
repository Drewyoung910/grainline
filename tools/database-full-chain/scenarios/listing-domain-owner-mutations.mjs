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

function createArgs({
  listingId,
  status = "DRAFT",
  isPrivate = false,
  reservedForUserId = null,
  conversationId = null,
  title = "Full-chain listing authority proof",
  photos,
  variantGroups = [],
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
    "MADE_TO_ORDER",
    null,
    null,
    7,
    14,
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
      altText: "Replacement side view",
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
