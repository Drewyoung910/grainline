import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function withSession(database, role, operation) {
  await database.query(`SET SESSION AUTHORIZATION ${role}`);
  try {
    return await operation();
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }
}

export async function proveListingDomainStaffReferences({ database, seller }) {
  const suffix = randomUUID();
  const staffId = `listing-staff-reference-${suffix}`;
  const listingIds = [
    `listing-staff-public-${suffix}`,
    `listing-staff-private-${suffix}`,
    `listing-staff-hidden-${suffix}`,
  ];
  const now = "2026-11-02 13:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.proname AS name,
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
         'public.grainline_listing_staff_reference_targets(text,text[])'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_listing_staff_seller_active_public_count(text,text)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_listing_staff_reference_targets",
      runtimeExecute: false,
      staffExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_listing_staff_seller_active_public_count",
      runtimeExecute: false,
      staffExecute: true,
      publicExecute: false,
    },
  ]);

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, "createdAt", "updatedAt",
        "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Listing reference staff', 'ADMIN',
             $4, $4, $4, '2026-01-01', $4)`,
    [
      staffId,
      `clerk_${staffId}`.slice(0, 191),
      `${staffId}@example.test`.slice(0, 191),
      now,
    ],
  );

  const baselineCount = await withSession(
    database,
    "grainline_staff_read_runtime",
    async () => Number(rowsOf(await database.query(
      `SELECT "activePublicCount"
         FROM public.grainline_listing_staff_seller_active_public_count(
           $1::text, $2::text
         )`,
      [staffId, seller.sellerProfileId],
    ))[0]?.activePublicCount),
  );

  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt")
     VALUES
       ($1, $4, 'Staff public target', 'Public', 1000, 'usd', 'ACTIVE',
        'IN_STOCK', 1, false, $5, $5),
       ($2, $4, 'Staff private target', 'Private', 1100, 'usd', 'ACTIVE',
        'MADE_TO_ORDER', NULL, true, $5, $5),
       ($3, $4, 'Staff hidden target', 'Hidden', 1200, 'usd', 'HIDDEN',
        'MADE_TO_ORDER', NULL, false, $5, $5)`,
    [...listingIds, seller.sellerProfileId, now],
  );

  await withSession(database, "grainline_staff_read_runtime", async () => {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_listing_staff_reference_targets(
           $1::text, $2::text[]
         )`,
      [staffId, [listingIds[2], listingIds[0], listingIds[1]]],
    )), [
      {
        id: listingIds[2],
        title: "Staff hidden target",
        sellerProfileId: seller.sellerProfileId,
      },
      {
        id: listingIds[0],
        title: "Staff public target",
        sellerProfileId: seller.sellerProfileId,
      },
      {
        id: listingIds[1],
        title: "Staff private target",
        sellerProfileId: seller.sellerProfileId,
      },
    ]);

    const activeCount = Number(rowsOf(await database.query(
      `SELECT "activePublicCount"
         FROM public.grainline_listing_staff_seller_active_public_count(
           $1::text, $2::text
         )`,
      [staffId, seller.sellerProfileId],
    ))[0]?.activePublicCount);
    assert.equal(activeCount, baselineCount + 1);

    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_listing_staff_reference_targets(
             $1::text, $2::text[]
           )`,
        [staffId, [listingIds[0], listingIds[0]]],
      ),
      /input is invalid/u,
    );

    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_listing_staff_reference_targets(
             $1::text, $2::text[]
           )`,
        [staffId, Array.from({ length: 51 }, (_, index) => `listing-${index}`)],
      ),
      /input is invalid/u,
    );

    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_listing_staff_reference_targets(
             $1::text, $2::text[]
           )`,
        [seller.userId, [listingIds[0]]],
      ),
      /not authorized/u,
    );
  });

  await withSession(database, "grainline_app_runtime", async () => {
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_listing_staff_reference_targets(
             $1::text, $2::text[]
           )`,
        [staffId, [listingIds[0]]],
      ),
      /permission denied/u,
    );
  });

  await database.query(`DELETE FROM public."Listing" WHERE id = ANY($1::text[])`, [
    listingIds,
  ]);
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [staffId]);
}
