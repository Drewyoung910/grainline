import assert from "node:assert/strict";

function rowsOf(result) {
  return Array.isArray(result) ? result : result?.rows ?? [];
}

export async function proveSellerProfilePublicBlogAuthorSitemap({ database, seller }) {
  const postId = `${seller.sellerProfileId}_author_sitemap`;

  assert.deepEqual(rowsOf(await database.query(`
    SELECT routine.prosecdef AS "securityDefiner",
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
     WHERE routine.oid = pg_catalog.to_regprocedure(
       'public.grainline_seller_public_blog_author_sitemap(integer,integer)'
     )
  `)), [{
    securityDefiner: true,
    volatility: "s",
    config: ["search_path=pg_catalog"],
    runtimeExecute: true,
    publicExecute: false,
  }]);

  const insertedPost = rowsOf(await database.query(
    `INSERT INTO public."BlogPost"
      (id, slug, title, body, "authorId", "authorType", "sellerProfileId", status,
       "authorAccountActive", "publishedAt", "createdAt", "updatedAt")
     VALUES ($1, $2, 'Full Chain Author Sitemap', 'Full-chain sitemap proof',
             $3, 'MAKER', $4, 'PUBLISHED', true,
             pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
             pg_catalog.statement_timestamp() AT TIME ZONE 'UTC',
             pg_catalog.statement_timestamp() AT TIME ZONE 'UTC')
     RETURNING "updatedAt" AT TIME ZONE 'UTC' AS "updatedAt"`,
    [
      postId,
      `author-sitemap-${seller.sellerProfileId}`.slice(0, 255),
      seller.userId,
      seller.sellerProfileId,
    ],
  ));
  assert.equal(insertedPost.length, 1);

  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      `SELECT *
         FROM public.grainline_seller_public_blog_author_sitemap(500,100)`,
    )), [{
      id: seller.sellerProfileId,
      displayName: "Full Chain Workshop",
      updatedAt: insertedPost[0].updatedAt,
    }]);
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_blog_author_sitemap(501,100)",
      ),
      (error) => error?.code === "22023",
    );
  } finally {
    await database.query("RESET ROLE");
  }

  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = true
      WHERE id = $1`,
    [seller.sellerProfileId],
  );
  await database.query("SET ROLE grainline_app_runtime");
  try {
    assert.deepEqual(rowsOf(await database.query(
      "SELECT * FROM public.grainline_seller_public_blog_author_sitemap(500,100)",
    )), []);
  } finally {
    await database.query("RESET ROLE");
  }
  await database.query(
    `UPDATE public."SellerProfile"
        SET "vacationMode" = false
      WHERE id = $1`,
    [seller.sellerProfileId],
  );

  await database.query("DELETE FROM public.\"BlogPost\" WHERE id = $1", [postId]);
}
