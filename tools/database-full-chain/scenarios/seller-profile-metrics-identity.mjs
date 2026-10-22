import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileMetricsIdentity({ database, seller }) {
  const expected = rowsOf(await database.query(
    `SELECT seller."userId"::text AS "sellerUserId",
            floor(EXTRACT(EPOCH FROM (seller."createdAt" AT TIME ZONE 'UTC')) * 1000)::bigint
              AS "createdAtEpochMillis"
       FROM public."SellerProfile" AS seller
      WHERE seller.id = $1`,
    [seller.sellerProfileId],
  ));
  assert.equal(expected.length, 1);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    const actual = rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_service_metrics_identity($1)`,
      [seller.sellerProfileId],
    ));
    assert.deepEqual(actual, expected);
    assert.deepEqual(rowsOf(await database.query(
      `SELECT * FROM public.grainline_seller_service_metrics_identity('missing-seller')`,
    )), []);
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SET ROLE grainline_staff_read_runtime");
  try {
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_seller_service_metrics_identity($1)`,
        [seller.sellerProfileId],
      ),
      /permission denied/u,
    );
  } finally {
    await database.query("RESET ROLE");
  }
}
