import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020000000_prepare_seller_profile_conversation_participant_cards/migration.sql",
  "utf8",
);
const correction = readFileSync(
  "prisma/migrations/20261020030000_correct_seller_profile_conversation_participant_cards/migration.sql",
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
      id varchar(191) PRIMARY KEY,
      "userId" varchar(191) NOT NULL UNIQUE,
      "displayName" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048),
      "acceptsCustomOrders" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public."Conversation" (
      id text PRIMARY KEY,
      "userAId" text NOT NULL,
      "userBId" text NOT NULL
    );
    INSERT INTO public."User" (id, banned, "deletedAt") VALUES
      ('active-actor', false, NULL),
      ('banned-actor', true, NULL),
      ('deleted-actor', false, now()),
      ('connected-seller', false, NULL),
      ('second-seller', false, NULL),
      ('unconnected-seller', false, NULL);
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl", "acceptsCustomOrders",
      "chargesEnabled", "stripeAccountSupported"
    ) VALUES
      ('seller-connected', 'connected-seller', 'Connected Shop', 'https://cdn/avatar.webp', true, true, true),
      ('seller-second', 'second-seller', '', NULL, false, false, true),
      ('seller-unconnected', 'unconnected-seller', 'Hidden Shop', NULL, true, true, true);
    INSERT INTO public."Conversation" (id, "userAId", "userBId") VALUES
      ('conversation-1', 'active-actor', 'connected-seller'),
      ('conversation-2', 'second-seller', 'active-actor'),
      ('conversation-3', 'banned-actor', 'connected-seller'),
      ('conversation-4', 'deleted-actor', 'connected-seller');
  `);
  await database.exec(migration);
  await database.exec(correction);
  return database;
}

test("conversation participant cards return only requested sellers related to the active actor", async () => {
  const database = await readyDatabase();
  try {
    await database.query("SELECT set_config('app.user_id', 'active-actor', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual(
      (await database.query(`
        SELECT *
          FROM public.grainline_seller_actor_conversation_cards(
            ARRAY['second-seller', 'unconnected-seller', 'connected-seller']::text[]
          )
      `)).rows,
      [
        {
          sellerProfileId: "seller-second",
          userId: "second-seller",
          displayName: "",
          avatarImageUrl: null,
          acceptsCustomOrders: false,
          chargesEnabled: false,
          stripeAccountSupported: true,
        },
        {
          sellerProfileId: "seller-connected",
          userId: "connected-seller",
          displayName: "Connected Shop",
          avatarImageUrl: "https://cdn/avatar.webp",
          acceptsCustomOrders: true,
          chargesEnabled: true,
          stripeAccountSupported: true,
        },
      ],
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("conversation participant cards reject invalid requests and hide cards from inactive actors", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_actor_conversation_cards(
            ARRAY['connected-seller']::text[]
          )
      `),
      /context is invalid/u,
    );
    await database.exec("RESET ROLE");

    await database.query("SELECT set_config('app.user_id', 'active-actor', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_actor_conversation_cards(
            ARRAY['connected-seller', 'connected-seller']::text[]
          )
      `),
      /target set is invalid/u,
    );
    await database.exec("RESET ROLE");

    for (const actorId of ["banned-actor", "deleted-actor", "missing-actor"]) {
      await database.query("SELECT set_config('app.user_id', $1, false)", [actorId]);
      await database.exec("SET ROLE grainline_app_runtime");
      assert.deepEqual(
        (await database.query(`
          SELECT *
            FROM public.grainline_seller_actor_conversation_cards(
              ARRAY['connected-seller']::text[]
            )
        `)).rows,
        [],
      );
      await database.exec("RESET ROLE");
    }

    await database.query("SELECT set_config('app.user_id', 'active-actor', false)");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(`
        SELECT *
          FROM public.grainline_seller_actor_conversation_cards(
            ARRAY['connected-seller']::text[]
          )
      `),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
