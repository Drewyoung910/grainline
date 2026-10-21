import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

async function readAsRuntime(database, actorId, conversationId) {
  await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    return rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_actor_conversation_context_listing($1)",
      [conversationId],
    ));
  } finally {
    await database.query("RESET ROLE");
  }
}

export async function proveSellerProfileConversationContextListing({ database, seller }) {
  const actorId = `${seller.userId}_context_actor`;
  const unrelatedId = `${seller.userId}_context_unrelated`;
  const staffId = `${seller.userId}_context_staff`;
  const conversationId = `${seller.sellerProfileId}_context_conversation`;
  const listingId = `${seller.sellerProfileId}_context_listing`;
  const photoId = `${listingId}_photo`;
  const reportId = `${conversationId}_report`;
  const now = "2026-10-21 12:30:00";

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
           routine.provolatile AS volatility,
           routine.proconfig AS config,
           pg_catalog.has_function_privilege(
             'grainline_app_runtime', routine.oid, 'EXECUTE'
           ) AS "runtimeExecute",
           pg_catalog.has_function_privilege(
             'grainline_staff_read_runtime', routine.oid, 'EXECUTE'
           ) AS "staffReadExecute",
           EXISTS (
             SELECT 1
               FROM pg_catalog.aclexplode(
                 COALESCE(routine.proacl, pg_catalog.acldefault('f', routine.proowner))
               ) AS acl
              WHERE acl.grantee = 0
                AND acl.privilege_type = 'EXECUTE'
           ) AS "publicExecute"
      FROM pg_catalog.pg_proc AS routine
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_seller_actor_conversation_context_listing(text)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    staffReadExecute: false,
    publicExecute: false,
  }]);

  await database.query(
    `INSERT INTO public."User"
      (id, "clerkId", email, name, role, "createdAt", "updatedAt",
       "termsAcceptedAt", "termsVersion", "ageAttestedAt")
     VALUES
       ($1, $2, $3, 'Context actor', 'USER', $10, $10, $10, '2026-01-01', $10),
       ($4, $5, $6, 'Context unrelated', 'USER', $10, $10, $10, '2026-01-01', $10),
       ($7, $8, $9, 'Context staff', 'ADMIN', $10, $10, $10, '2026-01-01', $10)`,
    [
      actorId,
      `user_${actorId}`.slice(0, 191),
      `${actorId}@example.test`.slice(0, 191),
      unrelatedId,
      `user_${unrelatedId}`.slice(0, 191),
      `${unrelatedId}@example.test`.slice(0, 191),
      staffId,
      `user_${staffId}`.slice(0, 191),
      `${staffId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
      (id, "sellerId", title, description, "priceCents", currency, status,
       "listingType", "stockQuantity", "isPrivate", "reservedForUserId",
       "archivedAt", "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'Conversation history listing', 'Retained context-card proof',
        12500, 'usd', 'ACTIVE', 'IN_STOCK', 1, false, NULL, NULL, $3, $3)`,
    [listingId, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Photo"
      (id, "listingId", url, "originalUrl", "sortOrder", "createdAt")
     VALUES ($1, $2, 'https://example.test/context.jpg',
             'https://example.test/context-original.jpg', 0, $3)`,
    [photoId, listingId, now],
  );
  await database.query(
    `INSERT INTO public."Conversation"
      (id, "userAId", "userBId", "contextListingId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $5, $5)`,
    [conversationId, actorId, seller.userId, listingId, now],
  );

  const expectedCard = {
    listingId,
    title: "Conversation history listing",
    priceCents: 12500,
    currency: "usd",
    photoUrl: "https://example.test/context.jpg",
    canViewDetail: true,
  };
  assert.deepEqual(await readAsRuntime(database, actorId, conversationId), [expectedCard]);
  assert.deepEqual(await readAsRuntime(database, unrelatedId, conversationId), []);

  await database.query(
    `UPDATE public."SellerProfile" SET "vacationMode" = true WHERE id = $1`,
    [seller.sellerProfileId],
  );
  assert.deepEqual(await readAsRuntime(database, actorId, conversationId), [{
    ...expectedCard,
    canViewDetail: false,
  }]);

  await database.query(
    `UPDATE public."SellerProfile" SET "vacationMode" = false WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await database.query(
    `UPDATE public."Listing"
        SET status = 'SOLD_OUT', "updatedAt" = $2
      WHERE id = $1`,
    [listingId, now],
  );
  assert.deepEqual(await readAsRuntime(database, actorId, conversationId), [expectedCard]);

  await database.query(
    `UPDATE public."Listing"
        SET status = 'ACTIVE', "isPrivate" = true, "reservedForUserId" = $2,
            "updatedAt" = $3
      WHERE id = $1`,
    [listingId, actorId, now],
  );
  assert.deepEqual(await readAsRuntime(database, actorId, conversationId), [expectedCard]);
  assert.deepEqual(await readAsRuntime(database, seller.userId, conversationId), [expectedCard]);

  await database.query(
    `UPDATE public."User" SET banned = true WHERE id = $1`,
    [actorId],
  );
  assert.deepEqual(await readAsRuntime(database, actorId, conversationId), [{
    ...expectedCard,
    canViewDetail: false,
  }]);
  await database.query(
    `UPDATE public."User" SET banned = false WHERE id = $1`,
    [actorId],
  );

  await database.query(
    `INSERT INTO public."UserReport"
      (id, "reporterId", "reportedId", reason, "targetType", "targetId", resolved, "createdAt")
     VALUES ($1, $2, $3, 'Thread review', 'MESSAGE_THREAD', $4, false, $5)`,
    [reportId, actorId, seller.userId, conversationId, now],
  );
  await database.query(
    `UPDATE public."Listing"
        SET "reservedForUserId" = $2, "updatedAt" = $3
      WHERE id = $1`,
    [listingId, staffId, now],
  );
  assert.deepEqual(await readAsRuntime(database, staffId, conversationId), [{
    ...expectedCard,
    canViewDetail: false,
  }]);

  await database.query(
    `UPDATE public."Listing"
        SET "isPrivate" = false, "reservedForUserId" = NULL, "updatedAt" = $2
      WHERE id = $1`,
    [listingId, now],
  );
  assert.deepEqual(await readAsRuntime(database, staffId, conversationId), [expectedCard]);

  await database.query(
    `UPDATE public."Listing" SET "archivedAt" = $2 WHERE id = $1`,
    [listingId, now],
  );
  assert.deepEqual(await readAsRuntime(database, actorId, conversationId), [{
    ...expectedCard,
    canViewDetail: false,
  }]);
  assert.deepEqual(await readAsRuntime(database, seller.userId, conversationId), [{
    ...expectedCard,
    canViewDetail: false,
  }]);

  await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_actor_conversation_context_listing('bad id')",
      ),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query("SELECT set_config('app.user_id', '', false)");
  await database.query(`DELETE FROM public."UserReport" WHERE id = $1`, [reportId]);
  await database.query(`DELETE FROM public."Conversation" WHERE id = $1`, [conversationId]);
  await database.query(`DELETE FROM public."Photo" WHERE id = $1`, [photoId]);
  await database.query(`DELETE FROM public."Listing" WHERE id = $1`, [listingId]);
  await database.query(
    `DELETE FROM public."User" WHERE id = ANY($1::text[])`,
    [[actorId, unrelatedId, staffId]],
  );
}
