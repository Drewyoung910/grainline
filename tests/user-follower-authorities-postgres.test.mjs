import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261007040000_prepare_user_follower_authorities/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3),
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountVersion" text,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "ownerAccountActive" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Follow" (
      id text PRIMARY KEY,
      "followerId" text NOT NULL,
      "sellerProfileId" text NOT NULL
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL,
      "blockedId" text NOT NULL
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL,
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Favorite" (
      "userId" text NOT NULL,
      "listingId" text NOT NULL,
      PRIMARY KEY ("userId", "listingId")
    );
    INSERT INTO public."User" (
      id, banned, "deletedAt", "notificationPreferences"
    ) VALUES
      ('owner', false, NULL, '{}'),
      ('active-follower', false, NULL, '{"SELLER_BROADCAST":false}'),
      ('banned-follower', true, NULL, '{}'),
      ('deleted-follower', false, '2026-10-01', '{}'),
      ('seller-follower', false, NULL, '{"SELLER_BROADCAST":true}'),
      ('blocked-follower', false, NULL, '{}'),
      ('other-owner', false, NULL, '{}');
    INSERT INTO public."SellerProfile" (
      id, "userId", "chargesEnabled", "stripeAccountVersion",
      "vacationMode", "ownerAccountActive"
    ) VALUES
      ('seller-owner', 'owner', true, 'v2', false, true),
      ('seller-follower-profile', 'seller-follower', true, 'v2', false, true),
      ('seller-other', 'other-owner', true, 'v2', false, true);
    INSERT INTO public."Follow" (id, "followerId", "sellerProfileId") VALUES
      ('follow-a', 'active-follower', 'seller-owner'),
      ('follow-b', 'banned-follower', 'seller-owner'),
      ('follow-c', 'deleted-follower', 'seller-owner'),
      ('follow-d', 'seller-follower', 'seller-owner'),
      ('follow-e', 'blocked-follower', 'seller-owner'),
      ('follow-f', 'owner', 'seller-owner');
    INSERT INTO public."Block" (id, "blockerId", "blockedId") VALUES
      ('block-a', 'blocked-follower', 'owner');
    INSERT INTO public."Listing" (id, "sellerId", status, "isPrivate") VALUES
      ('listing-public', 'seller-owner', 'ACTIVE', false),
      ('listing-private', 'seller-owner', 'ACTIVE', true),
      ('listing-inactive', 'seller-owner', 'SOLD', false);
    INSERT INTO public."Favorite" ("userId", "listingId") VALUES
      ('active-follower', 'listing-public'),
      ('banned-follower', 'listing-public'),
      ('deleted-follower', 'listing-public'),
      ('seller-follower', 'listing-public'),
      ('blocked-follower', 'listing-public'),
      ('active-follower', 'listing-private'),
      ('active-follower', 'listing-inactive');
    REVOKE ALL ON TABLE public."User", public."SellerProfile", public."Follow",
      public."Block", public."Listing", public."Favorite"
      FROM grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

async function asRuntime(database, sql, params = []) {
  await database.exec("BEGIN");
  try {
    await database.exec("SET LOCAL ROLE grainline_app_runtime");
    return await database.query(sql, params);
  } finally {
    await database.exec("ROLLBACK");
  }
}

async function asOwner(database, userId, sql, params = []) {
  await database.exec("BEGIN");
  try {
    await database.exec("SET LOCAL ROLE grainline_app_runtime");
    await database.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    return await database.query(sql, params);
  } finally {
    await database.exec("ROLLBACK");
  }
}

describe("User follower authority PostgreSQL proof", () => {
  it("pages active unblocked follower ids without exposing preferences", async () => {
    const database = await createDatabase();
    try {
      const first = await asRuntime(
        database,
        "SELECT * FROM public.grainline_user_follower_notification_page($1, NULL, 1)",
        ["seller-owner"],
      );
      assert.deepEqual(first.rows, [
        { followId: "follow-a", followerId: "active-follower" },
      ]);
      const second = await asRuntime(
        database,
        "SELECT * FROM public.grainline_user_follower_notification_page($1, $2, 1000)",
        ["seller-owner", "follow-a"],
      );
      assert.deepEqual(second.rows, [
        { followId: "follow-d", followerId: "seller-follower" },
      ]);
      assert.deepEqual(Object.keys(second.rows[0]).sort(), ["followId", "followerId"]);
    } finally {
      await database.close();
    }
  });

  it("binds broadcast preferences to the authenticated seller owner", async () => {
    const database = await createDatabase();
    try {
      const all = await asOwner(
        database,
        "owner",
        "SELECT * FROM public.grainline_user_owner_broadcast_follower_page($1, NULL, 1000, false)",
        ["seller-owner"],
      );
      assert.deepEqual(all.rows, [
        {
          followId: "follow-a",
          followerId: "active-follower",
          notificationPreferences: { SELLER_BROADCAST: false },
        },
        {
          followId: "follow-d",
          followerId: "seller-follower",
          notificationPreferences: { SELLER_BROADCAST: true },
        },
      ]);
      const sellersOnly = await asOwner(
        database,
        "owner",
        "SELECT * FROM public.grainline_user_owner_broadcast_follower_page($1, NULL, 1000, true)",
        ["seller-owner"],
      );
      assert.deepEqual(sellersOnly.rows.map((row) => row.followerId), [
        "seller-follower",
      ]);
      const foreign = await asOwner(
        database,
        "other-owner",
        "SELECT * FROM public.grainline_user_owner_broadcast_follower_page($1, NULL, 1000, false)",
        ["seller-owner"],
      );
      assert.deepEqual(foreign.rows, []);
    } finally {
      await database.close();
    }
  });

  it("counts only eligible favorites for public active listings", async () => {
    const database = await createDatabase();
    try {
      const result = await asRuntime(
        database,
        "SELECT * FROM public.grainline_user_public_listing_favorite_counts($1::text[])",
        [["listing-public", "listing-private", "listing-inactive"]],
      );
      assert.deepEqual(
        result.rows.map((row) => ({
          listingId: row.listingId,
          favoriteCount: Number(row.favoriteCount),
        })),
        [{ listingId: "listing-public", favoriteCount: 2 }],
      );
    } finally {
      await database.close();
    }
  });

  it("rejects unbounded or ambiguous inputs", async () => {
    const database = await createDatabase();
    try {
      await assert.rejects(
        asRuntime(
          database,
          "SELECT * FROM public.grainline_user_follower_notification_page($1, NULL, 1001)",
          ["seller-owner"],
        ),
        /User follower notification page input is invalid/,
      );
      await assert.rejects(
        asRuntime(
          database,
          "SELECT * FROM public.grainline_user_public_listing_favorite_counts($1::text[])",
          [["listing-public", "listing-public"]],
        ),
        /User public listing favorite count input is invalid/,
      );
    } finally {
      await database.close();
    }
  });

  it("denies direct tables and PUBLIC function execution while granting runtime", async () => {
    const database = await createDatabase();
    try {
      await database.exec("SET ROLE grainline_app_runtime");
      await assert.rejects(
        database.query('SELECT * FROM public."User"'),
        /permission denied/,
      );
      await database.exec("RESET ROLE");
      const privileges = await database.query(`
        SELECT pg_catalog.count(*)::int AS function_count,
               pg_catalog.bool_and(procedure.prosecdef) AS all_definer,
               pg_catalog.bool_and(
                 procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
               ) AS all_fixed_path,
               pg_catalog.bool_and(
                 pg_catalog.has_function_privilege(
                   'grainline_app_runtime', procedure.oid, 'EXECUTE'
                 )
               ) AS all_runtime_execute,
               NOT pg_catalog.bool_or(
                 EXISTS (
                   SELECT 1
                     FROM pg_catalog.aclexplode(
                       COALESCE(
                         procedure.proacl,
                         pg_catalog.acldefault('f', procedure.proowner)
                       )
                     ) AS privilege
                    WHERE privilege.grantee = 0
                      AND privilege.privilege_type = 'EXECUTE'
                 )
               ) AS no_public_execute
          FROM pg_catalog.pg_proc AS procedure
          JOIN pg_catalog.pg_namespace AS namespace
            ON namespace.oid = procedure.pronamespace
         WHERE namespace.nspname = 'public'
           AND procedure.proname = ANY(ARRAY[
             'grainline_user_follower_notification_page',
             'grainline_user_owner_broadcast_follower_page',
             'grainline_user_public_listing_favorite_counts'
           ]::text[])
      `);
      assert.deepEqual(privileges.rows[0], {
        function_count: 3,
        all_definer: true,
        all_fixed_path: true,
        all_runtime_execute: true,
        no_public_execute: true,
      });
    } finally {
      await database.close();
    }
  });
});
