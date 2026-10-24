import assert from "node:assert/strict";
import pg from "pg";

export const CART_CARTITEM_RLS_MIGRATION =
  "20261023080000_activate_cart_cart_item_rls";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function setActor(database, userId) {
  await database.query(
    "SELECT pg_catalog.set_config('app.user_id', $1, false)",
    [userId ?? ""],
  );
}

export async function seedCartCartItemPredecessorFixture({ database, seller }) {
  const suffix = `cart_rls_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const now = "2026-10-23 12:00:00";
  const fixture = Object.freeze({
    ownerA: `${suffix}_owner_a`,
    ownerB: `${suffix}_owner_b`,
    admin: `${suffix}_admin`,
    employee: `${suffix}_employee`,
    cartA: `${suffix}_cart_a`,
    cartB: `${suffix}_cart_b`,
    adminListing: `${suffix}_admin_listing`,
    sellerListing: `${suffix}_seller_listing`,
    itemAAdmin: `${suffix}_item_a_admin`,
    itemBAdmin: `${suffix}_item_b_admin`,
    itemASeller: `${suffix}_item_a_seller`,
    itemBSeller: `${suffix}_item_b_seller`,
    now,
    sellerUserId: seller.userId,
  });

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'Cart owner A', 'USER', false, $13, $13),
       ($4, $5, $6, 'Cart owner B', 'USER', false, $13, $13),
       ($7, $8, $9, 'Cart admin', 'ADMIN', false, $13, $13),
       ($10, $11, $12, 'Cart employee', 'EMPLOYEE', false, $13, $13)`,
    [
      fixture.ownerA,
      `clerk_${fixture.ownerA}`,
      `${fixture.ownerA}@example.test`,
      fixture.ownerB,
      `clerk_${fixture.ownerB}`,
      `${fixture.ownerB}@example.test`,
      fixture.admin,
      `clerk_${fixture.admin}`,
      `${fixture.admin}@example.test`,
      fixture.employee,
      `clerk_${fixture.employee}`,
      `${fixture.employee}@example.test`,
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Listing"
       (id, "sellerId", title, description, "priceCents", currency, status,
        "listingType", "stockQuantity", "isPrivate", "createdAt", "updatedAt")
     VALUES
       ($1, $3, 'Cart admin cleanup', 'Cart RLS admin cleanup fixture', 1200,
        'usd', 'ACTIVE', 'IN_STOCK', 20, false, $4, $4),
       ($2, $3, 'Cart seller cleanup', 'Cart RLS seller cleanup fixture', 1800,
        'usd', 'ACTIVE', 'IN_STOCK', 20, false, $4, $4)`,
    [fixture.adminListing, fixture.sellerListing, seller.sellerProfileId, now],
  );
  await database.query(
    `INSERT INTO public."Cart" (id, "userId", "createdAt", "updatedAt")
     VALUES ($1, $2, $5, $5), ($3, $4, $5, $5)`,
    [fixture.cartA, fixture.ownerA, fixture.cartB, fixture.ownerB, now],
  );
  await database.query(
    `INSERT INTO public."CartItem"
       (id, "cartId", "listingId", quantity, "priceCents", "priceVersion",
        "selectedVariantOptionIds", "variantKey", "createdAt")
     VALUES
       ($1, $5, $7, 1, 1200, 1, ARRAY[]::text[], 'admin-a', $9),
       ($2, $6, $7, 2, 1200, 1, ARRAY[]::text[], 'admin-b', $9),
       ($3, $5, $8, 3, 1800, 1, ARRAY[]::text[], 'seller-a', $9),
       ($4, $6, $8, 4, 1800, 1, ARRAY[]::text[], 'seller-b', $9)`,
    [
      fixture.itemAAdmin,
      fixture.itemBAdmin,
      fixture.itemASeller,
      fixture.itemBSeller,
      fixture.cartA,
      fixture.cartB,
      fixture.adminListing,
      fixture.sellerListing,
      now,
    ],
  );
  return fixture;
}

export async function proveCartCartItemPredecessorExposure({
  database,
  fixture,
}) {
  await database.query("SET ROLE grainline_app_runtime");
  try {
    await setActor(database, fixture.ownerA);
    assert.deepEqual(
      rowsOf(
        await database.query(
          `SELECT id FROM public."Cart" WHERE id IN ($1, $2) ORDER BY id`,
          [fixture.cartA, fixture.cartB],
        ),
      ),
      [{ id: fixture.cartA }, { id: fixture.cartB }].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
      "predecessor runtime role must reproduce the cross-owner read exposure",
    );
    const changed = rowsOf(
      await database.query(
        `UPDATE public."CartItem"
          SET quantity = 5
        WHERE id = $1
      RETURNING id, quantity`,
        [fixture.itemBAdmin],
      ),
    );
    assert.deepEqual(changed, [{ id: fixture.itemBAdmin, quantity: 5 }]);
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }
  await database.query(
    `UPDATE public."CartItem" SET quantity = 2 WHERE id = $1`,
    [fixture.itemBAdmin],
  );
  return Object.freeze({ crossOwnerRead: true, crossOwnerWrite: true });
}

async function proveCartRowLock({ connectionString, fixture }) {
  const first = new pg.Client({ connectionString });
  const second = new pg.Client({ connectionString });
  await Promise.all([first.connect(), second.connect()]);
  try {
    await first.query("BEGIN");
    await first.query("SET LOCAL ROLE grainline_app_runtime");
    await first.query("SELECT pg_catalog.set_config('app.user_id', $1, true)", [
      fixture.ownerA,
    ]);
    await first.query(`SELECT id FROM public."Cart" WHERE id = $1 FOR UPDATE`, [
      fixture.cartA,
    ]);

    await second.query("BEGIN");
    await second.query("SET LOCAL ROLE grainline_app_runtime");
    await second.query("SET LOCAL lock_timeout = '250ms'");
    await second.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [fixture.ownerA],
    );
    await assert.rejects(
      second.query(
        `UPDATE public."Cart" SET "updatedAt" = $2 WHERE id = $1 RETURNING id`,
        [fixture.cartA, fixture.now],
      ),
      (error) => error?.code === "55P03",
      "second owner-cart update must wait behind the existing row lock",
    );
    await second.query("ROLLBACK");
    await first.query("COMMIT");

    await second.query("BEGIN");
    await second.query("SET LOCAL ROLE grainline_app_runtime");
    await second.query(
      "SELECT pg_catalog.set_config('app.user_id', $1, true)",
      [fixture.ownerA],
    );
    assert.deepEqual(
      (
        await second.query(
          `UPDATE public."Cart" SET "updatedAt" = $2 WHERE id = $1 RETURNING id`,
          [fixture.cartA, fixture.now],
        )
      ).rows,
      [{ id: fixture.cartA }],
    );
    await second.query("COMMIT");
  } finally {
    await first.query("ROLLBACK").catch(() => {});
    await second.query("ROLLBACK").catch(() => {});
    await Promise.all([first.end(), second.end()]);
  }
}

export async function proveCartCartItemRlsAuthorities({
  database,
  fixture,
  connectionString,
}) {
  assert.deepEqual(
    rowsOf(
      await database.query(`
    SELECT class.relname AS name,
           class.relrowsecurity AS enabled,
           class.relforcerowsecurity AS forced,
           (SELECT pg_catalog.count(*)::integer
              FROM pg_catalog.pg_policy AS policy
             WHERE policy.polrelid = class.oid) AS "policyCount"
      FROM pg_catalog.pg_class AS class
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = class.relnamespace
     WHERE namespace.nspname = 'public'
       AND class.relname IN ('Cart', 'CartItem')
     ORDER BY class.relname
  `),
    ),
    [
      { name: "Cart", enabled: true, forced: true, policyCount: 4 },
      { name: "CartItem", enabled: true, forced: true, policyCount: 4 },
    ],
  );

  await database.query("SET ROLE grainline_app_runtime");
  try {
    await setActor(database, null);
    assert.deepEqual(
      rowsOf(
        await database.query(
          `SELECT id FROM public."Cart" WHERE id IN ($1, $2)`,
          [fixture.cartA, fixture.cartB],
        ),
      ),
      [],
    );
    assert.deepEqual(
      rowsOf(
        await database.query(
          `SELECT id FROM public."CartItem" WHERE "cartId" IN ($1, $2)`,
          [fixture.cartA, fixture.cartB],
        ),
      ),
      [],
    );

    await setActor(database, fixture.ownerA);
    assert.deepEqual(
      rowsOf(
        await database.query(
          `SELECT id FROM public."Cart" WHERE id IN ($1, $2) ORDER BY id`,
          [fixture.cartA, fixture.cartB],
        ),
      ),
      [{ id: fixture.cartA }],
    );
    assert.deepEqual(
      rowsOf(
        await database.query(
          `SELECT id FROM public."CartItem" WHERE "cartId" IN ($1, $2) ORDER BY id`,
          [fixture.cartA, fixture.cartB],
        ),
      ),
      [{ id: fixture.itemAAdmin }, { id: fixture.itemASeller }].sort((a, b) =>
        a.id.localeCompare(b.id),
      ),
    );

    await assert.rejects(
      database.query(
        `INSERT INTO public."Cart" (id, "userId", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $3)`,
        [`${fixture.cartA}_forged`, fixture.admin, fixture.now],
      ),
      (error) => error?.code === "42501",
    );
    assert.equal(
      rowsOf(
        await database.query(
          `UPDATE public."CartItem" SET quantity = 6 WHERE id = $1 RETURNING id`,
          [fixture.itemBAdmin],
        ),
      ).length,
      0,
    );
    assert.equal(
      rowsOf(
        await database.query(
          `DELETE FROM public."CartItem" WHERE id = $1 RETURNING id`,
          [fixture.itemBAdmin],
        ),
      ).length,
      0,
    );
    await assert.rejects(
      database.query(
        `INSERT INTO public."CartItem"
           (id, "cartId", "listingId", quantity, "priceCents", "priceVersion",
            "selectedVariantOptionIds", "variantKey", "createdAt")
         VALUES ($1, $2, $3, 1, 1200, 1, ARRAY[]::text[], 'forged', $4)`,
        [
          `${fixture.itemAAdmin}_forged`,
          fixture.cartB,
          fixture.adminListing,
          fixture.now,
        ],
      ),
      (error) => error?.code === "42501",
    );
    await assert.rejects(
      database.query(
        `UPDATE public."CartItem" SET "listingId" = $2 WHERE id = $1`,
        [fixture.itemAAdmin, fixture.sellerListing],
      ),
      (error) => error?.code === "42501",
    );
    assert.deepEqual(
      rowsOf(
        await database.query(
          `UPDATE public."CartItem" SET quantity = 7 WHERE id = $1 RETURNING quantity`,
          [fixture.itemAAdmin],
        ),
      ),
      [{ quantity: 7 }],
    );
    for (const [column, value, code] of [
      ["quantity", 100, "23514"],
      ["priceCents", 0, "23514"],
      ["priceVersion", 0, "23514"],
    ]) {
      await assert.rejects(
        database.query(
          `UPDATE public."CartItem" SET "${column}" = $2 WHERE id = $1`,
          [fixture.itemAAdmin, value],
        ),
        (error) => error?.code === code,
      );
    }
    await assert.rejects(
      database.query(
        `UPDATE public."CartItem"
            SET "selectedVariantOptionIds" = ARRAY[
              '1','2','3','4','5','6','7','8','9','10',
              '11','12','13','14','15','16','17','18','19','20',
              '21','22','23','24','25','26','27','28','29','30','31'
            ]::text[]
          WHERE id = $1`,
        [fixture.itemAAdmin],
      ),
      (error) => error?.code === "23514",
    );
    await assert.rejects(
      database.query(
        `UPDATE public."CartItem"
            SET "selectedVariantOptionIds" = ARRAY[NULL]::text[]
          WHERE id = $1`,
        [fixture.itemAAdmin],
      ),
      (error) => error?.code === "23514",
    );

    await setActor(database, fixture.employee);
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_cart_item_admin_listing_cleanup($1)`,
        [fixture.adminListing],
      ),
      (error) => error?.code === "42501",
    );
    await setActor(database, fixture.admin);
    assert.deepEqual(
      rowsOf(
        await database.query(
          `SELECT * FROM public.grainline_cart_item_admin_listing_cleanup($1)`,
          [fixture.adminListing],
        ),
      ),
      [{ deleted_count: 2 }],
    );
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_cart_item_admin_listing_cleanup($1)`,
        [`${fixture.adminListing}_missing`],
      ),
      (error) => error?.code === "P0002",
    );

    await setActor(database, fixture.ownerA);
    await assert.rejects(
      database.query(
        `SELECT * FROM public.grainline_cart_item_seller_listing_cleanup($1)`,
        [fixture.sellerListing],
      ),
      (error) => error?.code === "42501",
    );
    await setActor(database, fixture.sellerUserId);
    assert.deepEqual(
      rowsOf(
        await database.query(
          `SELECT * FROM public.grainline_cart_item_seller_listing_cleanup($1)`,
          [fixture.sellerListing],
        ),
      ),
      [{ deleted_count: 2 }],
    );

    await setActor(database, fixture.ownerA);
    await proveCartRowLock({ connectionString, fixture });

    assert.deepEqual(
      rowsOf(
        await database.query(
          `DELETE FROM public."Cart" WHERE id = $1 RETURNING id`,
          [fixture.cartA],
        ),
      ),
      [{ id: fixture.cartA }],
    );
  } finally {
    await database.query("RESET ROLE");
    await database.query("RESET app.user_id");
  }

  assert.equal(
    rowsOf(
      await database.query(
        `SELECT id FROM public."CartItem" WHERE "cartId" = $1`,
        [fixture.cartA],
      ),
    ).length,
    0,
    "owner Cart deletion must cascade to its CartItem rows",
  );
  await database.query(`DELETE FROM public."User" WHERE id = $1`, [
    fixture.ownerB,
  ]);
  assert.equal(
    rowsOf(
      await database.query(`SELECT id FROM public."Cart" WHERE id = $1`, [
        fixture.cartB,
      ]),
    ).length,
    0,
    "account deletion must cascade to Cart",
  );
}
