import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileServiceIdentities({ database, seller }) {
  const buyerUserId = `${seller.userId}_service_buyer`;
  const expectedName = rowsOf(await database.query(
    `SELECT "displayName"::text AS "displayName"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [seller.sellerProfileId],
  ));
  assert.equal(expectedName.length, 1);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_service_welcome_name($1)`,
      [seller.userId],
    )), expectedName);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_transaction_blocked_pair_targets($1, $2)`,
      [buyerUserId, seller.userId],
    )), [{
      buyerUserId,
      sellerUserId: seller.userId,
      sellerProfileId: seller.sellerProfileId,
    }]);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SET ROLE grainline_staff_read_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_seller_service_welcome_name($1)`,
        [seller.userId],
      ),
      /permission denied/u,
    );
    await assert.rejects(
      database.query(
        `SELECT *
           FROM public.grainline_seller_transaction_blocked_pair_targets($1, $2)`,
        [buyerUserId, seller.userId],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }
}
