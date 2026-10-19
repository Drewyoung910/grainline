import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261019170000_prepare_seller_profile_follow_authority/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Follow" (
      id text PRIMARY KEY,
      "followerId" text NOT NULL,
      "sellerProfileId" text NOT NULL,
      "createdAt" timestamp(3) NOT NULL DEFAULT now(),
      UNIQUE ("followerId", "sellerProfileId")
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL,
      "blockedId" text NOT NULL,
      UNIQUE ("blockerId", "blockedId")
    );
    INSERT INTO public."User" (id) VALUES ('actor'), ('seller-owner'), ('hidden-owner');
    INSERT INTO public."SellerProfile" (
      id, "userId", "ownerAccountActive", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('visible-seller', 'seller-owner', true, true, true, true),
      ('hidden-seller', 'hidden-owner', true, false, true, false);

    CREATE OR REPLACE FUNCTION public.grainline_user_block_pair_lock(p_target_id text)
    RETURNS TABLE (id text, "deletedAt" timestamp(3))
    LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = pg_catalog
    AS $$
      SELECT account_user.id, account_user."deletedAt"
        FROM public."User" AS account_user
       WHERE account_user.id IN (
         NULLIF(pg_catalog.current_setting('app.user_id', true), ''),
         p_target_id
       )
       ORDER BY account_user.id
       FOR UPDATE
    $$;
    REVOKE ALL ON FUNCTION public.grainline_user_block_pair_lock(text) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.grainline_user_block_pair_lock(text)
      TO grainline_app_runtime;
  `);
  await database.exec(migration);
  return database;
}

test("public follow state preserves visibility and optional owner-bound following", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_state('visible-seller')",
      )).rows,
      [{ sellerProfileId: "visible-seller", followerCount: 0, following: false }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_state('hidden-seller')",
      )).rows,
      [],
    );
    await database.exec("RESET ROLE");

    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_create('visible-seller', 'follow-1')",
      )).rows,
      [{
        resultStatus: "OK",
        ownerUserId: "seller-owner",
        created: true,
        followerCount: 1,
      }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_state('visible-seller')",
      )).rows,
      [{ sellerProfileId: "visible-seller", followerCount: 1, following: true }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_create('visible-seller', 'follow-2')",
      )).rows,
      [{
        resultStatus: "OK",
        ownerUserId: "seller-owner",
        created: false,
        followerCount: 1,
      }],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("follow mutation refuses self/blocked/hidden targets and deletes stale follows", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'seller-owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.equal(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_create('visible-seller', 'self-follow')",
      )).rows[0].resultStatus,
      "SELF",
    );
    await database.exec("RESET ROLE");

    await database.query("SELECT set_config('app.user_id', 'actor', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.equal(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_create('hidden-seller', 'hidden-follow')",
      )).rows[0].resultStatus,
      "NOT_FOUND",
    );
    await database.exec("RESET ROLE");
    await database.exec(`
      INSERT INTO public."Block" (id, "blockerId", "blockedId")
      VALUES ('block-1', 'seller-owner', 'actor');
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    assert.equal(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_create('visible-seller', 'blocked-follow')",
      )).rows[0].resultStatus,
      "BLOCKED",
    );
    await database.exec("RESET ROLE");
    await database.exec('DELETE FROM public."Block"');
    await database.exec(`
      INSERT INTO public."Follow" (id, "followerId", "sellerProfileId")
      VALUES ('stale-follow', 'actor', 'hidden-seller');
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT * FROM public.grainline_seller_public_follow_delete('hidden-seller')",
      )).rows,
      [{ resultStatus: "OK", followerCount: 0 }],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("follow authorities reject missing context and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_follow_create('visible-seller', 'follow-1')",
      ),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_follow_state('visible-seller')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
