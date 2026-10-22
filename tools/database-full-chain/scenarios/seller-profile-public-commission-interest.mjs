import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicCommissionInterestAuthority({
  database,
  seller,
}) {
  const suffix = seller.sellerProfileId;
  const buyerId = `${suffix}_commission_buyer`;
  const requestId = `${suffix}_commission_request`;
  const closedRequestId = `${suffix}_commission_closed`;
  const interestId = `${suffix}_commission_interest`;
  const blockId = `${suffix}_commission_block`;
  const now = "2026-10-20 12:00:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.proname AS name,
           routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
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
         'public.grainline_seller_public_commission_interest_cards(text,integer)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_public_commission_interest_counts(text[])'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_owner_commission_interest_summaries(text[],integer)'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_service_commission_interest_targets(text,integer)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_seller_owner_commission_interest_summaries",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_seller_public_commission_interest_cards",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_seller_public_commission_interest_counts",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_seller_service_commission_interest_targets",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
  ]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Commission buyer', $4, $4, $4, '2026-01-01', $4)`,
    [
      buyerId,
      `user_${buyerId}`.slice(0, 191),
      `${buyerId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."CommissionRequest"
      (id, "buyerId", "buyerAccountActive", title, description, status,
       "expiresAt", "createdAt", "updatedAt")
     VALUES
       ($1, $3, true, 'Open commission', 'Full-chain public interest proof',
        'OPEN', NULL, $4, $4),
       ($2, $3, true, 'Closed commission', 'Full-chain closed request proof',
        'CLOSED', NULL, $4, $4)`,
    [requestId, closedRequestId, buyerId, now],
  );
  await database.query(
    `INSERT INTO public."CommissionInterest"
      (id, "commissionRequestId", "sellerProfileId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [interestId, requestId, seller.sellerProfileId, now],
  );
  const sellerDisplayName = rowsOf(await database.query(
    `SELECT "displayName"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ))[0]?.displayName;
  assert.equal(typeof sellerDisplayName, "string");

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(`
      SELECT "commissionRequestId", value
        FROM public.grainline_seller_public_commission_interest_counts(
          ARRAY[$1, $2]::text[]
        )
    `, [requestId, closedRequestId])), [
      { commissionRequestId: requestId, value: "1" },
    ]);
    assert.deepEqual(rowsOf(await database.query(`
      SELECT "interestId", "sellerProfileId", "displayName"
        FROM public.grainline_seller_public_commission_interest_cards($1, 100)
    `, [requestId])), [
      {
        interestId,
        sellerProfileId: seller.sellerProfileId,
        displayName: sellerDisplayName,
      },
    ]);
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [buyerId],
    );
    assert.deepEqual(rowsOf(await database.query(`
      SELECT "commissionRequestId", "interestedCount", "interestId",
             "sellerProfileId", "displayName"
        FROM public.grainline_seller_owner_commission_interest_summaries(
          ARRAY[$1, $2]::text[], 3
        )
    `, [requestId, closedRequestId])), [
      {
        commissionRequestId: requestId,
        interestedCount: "1",
        interestId,
        sellerProfileId: seller.sellerProfileId,
        displayName: sellerDisplayName,
      },
      {
        commissionRequestId: closedRequestId,
        interestedCount: "0",
        interestId: null,
        sellerProfileId: null,
        displayName: null,
      },
    ]);
    assert.deepEqual(rowsOf(await database.query(`
      SELECT "userId"
        FROM public.grainline_seller_service_commission_interest_targets($1, 10000)
    `, [requestId])), [{ userId: seller.userId }]);
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [seller.userId],
    );
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_owner_commission_interest_summaries(
            ARRAY[$1]::text[], 3
          )
      `, [requestId]),
      (error) => error?.code === "42501",
    );
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_counts(
            ARRAY[]::text[]
          )
      `),
      (error) => error?.code === "22023",
    );
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_cards($1, 101)
      `, [requestId]),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, seller.userId, buyerId, now],
  );
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [buyerId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(`
      SELECT "commissionRequestId", value
        FROM public.grainline_seller_public_commission_interest_counts(
          ARRAY[$1]::text[]
        )
    `, [requestId])), [{ commissionRequestId: requestId, value: "0" }]);
    assert.deepEqual(rowsOf(await database.query(`
      SELECT "interestId"
        FROM public.grainline_seller_public_commission_interest_cards($1, 100)
    `, [requestId])), []);
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', 'missing_viewer', false)",
    );
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_public_commission_interest_counts(
            ARRAY[$1]::text[]
          )
      `, [requestId]),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query(`DELETE FROM public."Block" WHERE id = $1`, [blockId]);
  await database.query(`DELETE FROM public."CommissionInterest" WHERE id = $1`, [interestId]);
  await database.query(
    `DELETE FROM public."CommissionRequest" WHERE id = ANY($1::text[])`,
    [[requestId, closedRequestId]],
  );
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [buyerId]);
}
