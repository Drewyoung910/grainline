import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const predecessor = readFileSync(
  "prisma/migrations/20261007030000_prepare_user_block_email_authorities/migration.sql",
  "utf8",
);
const migration = readFileSync(
  "prisma/migrations/20261019140000_prepare_seller_profile_block_follow_cleanup/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      email text,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3),
      name varchar(100),
      "imageUrl" varchar(2048)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "displayName" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048)
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id),
      "createdAt" timestamp(3) NOT NULL,
      UNIQUE ("blockerId", "blockedId")
    );
    CREATE TABLE public."Follow" (
      id text PRIMARY KEY,
      "followerId" text NOT NULL REFERENCES public."User"(id),
      "sellerProfileId" text NOT NULL REFERENCES public."SellerProfile"(id),
      "createdAt" timestamp(3) NOT NULL,
      UNIQUE ("followerId", "sellerProfileId")
    );
    CREATE TABLE public."UserEmailAddress" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id),
      email varchar(254) NOT NULL
    );
    INSERT INTO public."User" (id, email, banned, "deletedAt", name) VALUES
      ('actor', 'actor@example.test', false, NULL, 'Actor'),
      ('target', 'target@example.test', false, NULL, 'Target'),
      ('outsider', 'outsider@example.test', false, NULL, 'Outsider');
    INSERT INTO public."SellerProfile" (id, "userId", "displayName") VALUES
      ('seller-actor', 'actor', 'Actor Shop'),
      ('seller-target', 'target', 'Target Shop'),
      ('seller-outsider', 'outsider', 'Outsider Shop');
    INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt") VALUES
      ('block-actor-target', 'actor', 'target', '2026-10-19 12:00:00');
    INSERT INTO public."Follow" (id, "followerId", "sellerProfileId", "createdAt") VALUES
      ('actor-follows-target', 'actor', 'seller-target', '2026-10-19 11:00:00'),
      ('target-follows-actor', 'target', 'seller-actor', '2026-10-19 11:00:00'),
      ('actor-follows-outsider', 'actor', 'seller-outsider', '2026-10-19 11:00:00'),
      ('outsider-follows-actor', 'outsider', 'seller-actor', '2026-10-19 11:00:00'),
      ('target-follows-outsider', 'target', 'seller-outsider', '2026-10-19 11:00:00');
  `);
  await database.exec(predecessor);
  await database.exec(migration);
  return database;
}

async function asActor(database, actorId, targetId) {
  await database.exec("BEGIN");
  try {
    await database.exec("SET LOCAL ROLE grainline_app_runtime");
    await database.query("SELECT set_config('app.user_id', $1, true)", [actorId]);
    return await database.query(
      "SELECT public.grainline_user_block_follow_cleanup($1) AS deleted_count",
      [targetId],
    );
  } finally {
    await database.exec("COMMIT");
  }
}

test("block follow cleanup removes only the two reciprocal follows and is idempotent", async () => {
  const database = await readyDatabase();
  try {
    assert.deepEqual((await asActor(database, "actor", "target")).rows, [
      { deleted_count: 2 },
    ]);
    assert.deepEqual((await asActor(database, "actor", "target")).rows, [
      { deleted_count: 0 },
    ]);
    assert.deepEqual(
      (await database.query(`
        SELECT id FROM public."Follow" ORDER BY id
      `)).rows,
      [
        { id: "actor-follows-outsider" },
        { id: "outsider-follows-actor" },
        { id: "target-follows-outsider" },
      ],
    );
  } finally {
    await database.close();
  }
});

test("block follow cleanup rejects targets without the actor's exact block", async () => {
  const database = await readyDatabase();
  try {
    await assert.rejects(
      asActor(database, "actor", "outsider"),
      /User block follow cleanup requires an active block/u,
    );
    assert.equal((await database.query('SELECT count(*)::int AS value FROM public."Follow"')).rows[0].value, 5);
  } finally {
    await database.close();
  }
});

test("block follow cleanup denies missing context and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await assert.rejects(
      database.query("SELECT public.grainline_user_block_follow_cleanup('target')"),
      /User block follow cleanup input is invalid/u,
    );
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT public.grainline_user_block_follow_cleanup('target')"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
