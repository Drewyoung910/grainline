import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfileSavedBlogPostAuthority({ database, seller }) {
  const suffix = seller.sellerProfileId;
  const actorUserId = `${suffix}_saved_blog_actor`;
  const visiblePostId = `${suffix}_saved_blog_visible`;
  const platformPostId = `${suffix}_saved_blog_platform`;
  const futurePostId = `${suffix}_saved_blog_future`;
  const draftPostId = `${suffix}_saved_blog_draft`;
  const blockId = `${suffix}_saved_blog_block`;
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
         'public.grainline_seller_owner_saved_blog_post_count()'
       ),
       pg_catalog.to_regprocedure(
         'public.grainline_seller_owner_saved_blog_post_page(integer,integer)'
       )
     )
     ORDER BY routine.proname
  `)), [
    {
      name: "grainline_seller_owner_saved_blog_post_count",
      securityDefiner: true,
      volatility: "s",
      config: ["search_path=pg_catalog"],
      runtimeExecute: true,
      publicExecute: false,
    },
    {
      name: "grainline_seller_owner_saved_blog_post_page",
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
     VALUES ($1, $2, $3, 'Saved blog actor', $4, $4, $4, '2026-01-01', $4)`,
    [
      actorUserId,
      `user_${actorUserId}`.slice(0, 191),
      `${actorUserId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."BlogPost"
      (id, slug, title, excerpt, body, "authorId", "authorType",
       "sellerProfileId", type, status, "readingTimeMinutes", "publishedAt",
       "createdAt", "updatedAt")
     VALUES
       ($1::text, $1::text, 'Saved seller post', 'Seller excerpt', 'Seller body', $5,
        'MAKER', $6, 'STANDARD', 'PUBLISHED', 4, '2026-10-20 10:00:00', $7, $7),
       ($2::text, $2::text, 'Saved platform post', 'Platform excerpt', 'Platform body', $8,
        'STAFF', NULL, 'MAKER_SPOTLIGHT', 'PUBLISHED', 3,
        '2026-10-20 09:00:00', $7, $7),
       ($3::text, $3::text, 'Saved future post', 'Future excerpt', 'Future body', $5,
        'MAKER', $6, 'STANDARD', 'PUBLISHED', 2, '2099-01-01 00:00:00', $7, $7),
       ($4::text, $4::text, 'Saved draft post', 'Draft excerpt', 'Draft body', $5,
        'MAKER', $6, 'STANDARD', 'DRAFT', 2, '2026-10-20 08:00:00', $7, $7)`,
    [
      visiblePostId,
      platformPostId,
      futurePostId,
      draftPostId,
      seller.userId,
      seller.sellerProfileId,
      now,
      actorUserId,
    ],
  );
  await database.query(
    `INSERT INTO public."SavedBlogPost" (id, "userId", "blogPostId", "createdAt")
     VALUES
       ($1, $5, $6, '2026-10-20 12:00:00'),
       ($2, $5, $7, '2026-10-20 11:00:00'),
       ($3, $5, $8, '2026-10-20 10:00:00'),
       ($4, $5, $9, '2026-10-20 09:00:00')`,
    [
      `${suffix}_saved_blog_1`,
      `${suffix}_saved_blog_2`,
      `${suffix}_saved_blog_3`,
      `${suffix}_saved_blog_4`,
      actorUserId,
      visiblePostId,
      platformPostId,
      futurePostId,
      draftPostId,
    ],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_saved_blog_post_count()",
      ),
      (error) => error?.code === "42501",
    );
    await database.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, false)",
      [actorUserId],
    );
    const countRows = rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_owner_saved_blog_post_count()",
    ));
    assert.equal(countRows.length, 1);
    assert.equal(String(countRows[0].value), "2");
    assert.deepEqual(rowsOf(await database.query(`
      SELECT "blogPostId", title, "publishedAt"
        FROM public.grainline_seller_owner_saved_blog_post_page(24, 0)
    `)), [
      {
        blogPostId: visiblePostId,
        title: "Saved seller post",
        publishedAt: new Date("2026-10-20T10:00:00.000Z"),
      },
      {
        blogPostId: platformPostId,
        title: "Saved platform post",
        publishedAt: new Date("2026-10-20T09:00:00.000Z"),
      },
    ]);
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_owner_saved_blog_post_page(25, 0)",
      ),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.query("SELECT pg_catalog.set_config('app.user_id', '', false)");
    await database.query("RESET ROLE");
  }

  await database.query(
    `INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt")
     VALUES ($1, $2, $3, $4)`,
    [blockId, seller.userId, actorUserId, now],
  );
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [actorUserId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(`
      SELECT "blogPostId"
        FROM public.grainline_seller_owner_saved_blog_post_page(24, 0)
    `)), [{ blogPostId: platformPostId }]);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  await database.query(`DELETE FROM public."Block" WHERE id = $1`, [blockId]);
  await database.query(
    `DELETE FROM public."SavedBlogPost" WHERE "userId" = $1`,
    [actorUserId],
  );
  await database.query(
    `DELETE FROM public."BlogPost" WHERE id = ANY($1::text[])`,
    [[visiblePostId, platformPostId, futurePostId, draftPostId]],
  );
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [actorUserId]);
}
