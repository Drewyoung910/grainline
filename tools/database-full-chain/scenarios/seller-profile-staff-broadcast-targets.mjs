import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

export async function proveSellerProfileStaffBroadcastTargets({
  database,
  seller,
}) {
  const staffUserId = `${seller.userId}_broadcast_staff`;
  const broadcastId = `${seller.sellerProfileId}_staff_broadcast`;
  const now = new Date("2026-10-21T08:00:00.000Z");

  assert.deepEqual(
    rowsOf(
      await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime',
             routine.oid,
             'EXECUTE'
           ) AS "staffExecute",
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
       'public.grainline_seller_staff_broadcast_targets(text,text[])'
     )
  `),
    ),
    [
      {
        securityDefiner: true,
        volatility: "s",
        config: ["search_path=pg_catalog"],
        staffExecute: true,
        runtimeExecute: false,
        publicExecute: false,
      },
    ],
  );

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Broadcast Staff', 'EMPLOYEE', $4, $4, $4, '2026-01-01', $4)`,
    [
      staffUserId,
      `user_full_chain_broadcast_staff_${seller.userId}`,
      `broadcast-staff-${seller.userId}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."SellerBroadcast"
      (id, "sellerProfileId", message, "sentAt", "recipientCount")
     VALUES ($1, $2, 'A historical staff-visible update', $3, 4)`,
    [broadcastId, seller.sellerProfileId, now],
  );

  await database.query(
    "SET SESSION AUTHORIZATION grainline_staff_read_runtime",
  );
  try {
    assert.deepEqual(
      rowsOf(
        await database.query(
          `SELECT *
         FROM public.grainline_seller_staff_broadcast_targets($1, $2::text[])`,
          [staffUserId, [broadcastId, "missing", broadcastId]],
        ),
      ),
      [
        {
          broadcastId,
          sellerProfileId: seller.sellerProfileId,
          sellerUserId: seller.userId,
          sellerDisplayName: "Full Chain Workshop",
        },
      ],
    );

    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_broadcast_targets($1, $2::text[])`,
        [
          staffUserId,
          Array.from({ length: 51 }, (_, index) => `broadcast-${index}`),
        ],
      ),
      /input is invalid/u,
    );
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_broadcast_targets($1, $2::text[])`,
        [seller.userId, [broadcastId]],
      ),
      /actor is not authorized/u,
    );
    await assert.rejects(
      database.query(`SELECT id FROM public."SellerProfile" LIMIT 1`),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET SESSION AUTHORIZATION");
  }

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_staff_broadcast_targets($1, $2::text[])`,
        [staffUserId, [broadcastId]],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(`DELETE FROM public."SellerBroadcast" WHERE id = $1`, [
    broadcastId,
  ]);
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [
    staffUserId,
  ]);
}
