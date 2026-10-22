import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235930_prepare_seller_profile_owner_review_reply/migration.sql",
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
      "ownerAccountActive" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL
    );
    CREATE TABLE public."Review" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL,
      "sellerReply" varchar(2000),
      "sellerReplyAt" timestamp(3),
      "updatedAt" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    INSERT INTO public."User" (id, banned) VALUES
      ('owner', false),
      ('inactive-owner', false),
      ('foreign-owner', false);
    INSERT INTO public."SellerProfile" (id, "userId", "ownerAccountActive") VALUES
      ('seller', 'owner', true),
      ('inactive-seller', 'inactive-owner', false),
      ('foreign-seller', 'foreign-owner', true);
    INSERT INTO public."Listing" (id, "sellerId") VALUES
      ('listing', 'seller'),
      ('inactive-listing', 'inactive-seller'),
      ('foreign-listing', 'foreign-seller');
    INSERT INTO public."Review" (id, "listingId", "sellerReply") VALUES
      ('review', 'listing', NULL),
      ('existing', 'listing', 'Already saved'),
      ('inactive', 'inactive-listing', NULL),
      ('foreign', 'foreign-listing', NULL);
  `);
  await database.exec(migration);
  return database;
}

test("owner review-reply authority saves once for the active listing owner", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SELECT set_config('app.user_id', 'owner', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT public.grainline_seller_owner_review_reply('review','seller','Thank you') AS saved",
      )).rows,
      [{ saved: true }],
    );
    assert.deepEqual(
      (await database.query(
        "SELECT public.grainline_seller_owner_review_reply('review','seller','Overwrite') AS saved",
      )).rows,
      [{ saved: false }],
    );
    for (const [reviewId, sellerProfileId] of [
      ["existing", "seller"],
      ["inactive", "inactive-seller"],
      ["foreign", "seller"],
      ["review", "foreign-seller"],
    ]) {
      assert.deepEqual(
        (await database.query(
          "SELECT public.grainline_seller_owner_review_reply($1,$2,'Denied') AS saved",
          [reviewId, sellerProfileId],
        )).rows,
        [{ saved: false }],
      );
    }
    await database.exec("RESET ROLE");
    assert.deepEqual(
      (await database.query(`
        SELECT "sellerReply", "sellerReplyAt" IS NOT NULL AS "hasReplyAt",
               "updatedAt" = "sellerReplyAt" AS "timestampsMatch"
          FROM public."Review"
         WHERE id = 'review'
      `)).rows,
      [{ sellerReply: "Thank you", hasReplyAt: true, timestampsMatch: true }],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("owner review-reply authority denies inactive contexts and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(
        "SELECT public.grainline_seller_owner_review_reply('review','seller','Denied')",
      ),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SELECT set_config('app.user_id', 'owner', false)");
    await database.exec("UPDATE public.\"User\" SET banned = true WHERE id = 'owner'");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(
        "SELECT public.grainline_seller_owner_review_reply('review','seller','Denied') AS saved",
      )).rows,
      [{ saved: false }],
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT public.grainline_seller_owner_review_reply('review','seller','Denied')",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
