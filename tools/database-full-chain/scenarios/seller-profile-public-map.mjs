import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicMapAuthority({ database, seller }) {
  const viewerUserId = `${seller.userId}_map_viewer`;
  const viewerClerkId = `user_full_chain_map_viewer_${seller.userId}`;
  const viewerEmail = `map-${seller.userId}@example.test`;
  const blockId = `${seller.sellerProfileId}_map_block`;
  const now = new Date("2026-10-19T00:00:00.000Z");

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
            "updatedAt" = $2
      WHERE id = $1`,
    [seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, "createdAt", "updatedAt", "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES ($1, $2, $3, 'Map Viewer', $4, $4, $4, '2026-01-01', $4)`,
    [viewerUserId, viewerClerkId, viewerEmail, now],
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
  } finally {
    await database.query("RESET ROLE");
  }

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
  } finally {
    await database.query("RESET ROLE").catch(() => {});
  }
}
