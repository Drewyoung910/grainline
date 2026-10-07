import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261007030000_prepare_user_block_email_authorities/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime;
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      email text,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
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
      "createdAt" timestamp(3) without time zone NOT NULL,
      UNIQUE ("blockerId", "blockedId")
    );
    CREATE TABLE public."UserEmailAddress" (
      id text PRIMARY KEY,
      "userId" text NOT NULL REFERENCES public."User"(id),
      email varchar(254) NOT NULL
    );
    INSERT INTO public."User" (id, email, banned, "deletedAt", name, "imageUrl") VALUES
      ('actor', 'First.Last+tag@gmail.com', false, NULL, 'Actor', NULL),
      ('blocked', 'firstlast@gmail.com', false, NULL, 'Blocked User', 'https://example.test/blocked.png'),
      ('blocker', 'old@example.com', true, NULL, 'Blocking User', NULL),
      ('deleted', 'retired@example.com', false, '2026-10-01', 'Deleted User', NULL),
      ('safe', 'someone-else@example.com', false, NULL, 'Safe User', NULL);
    INSERT INTO public."SellerProfile" (id, "userId", "displayName", "avatarImageUrl") VALUES
      ('seller-blocked', 'blocked', 'Blocked Maker', 'https://example.test/maker.png'),
      ('seller-blocker', 'blocker', 'Blocking Maker', NULL);
    INSERT INTO public."Block" (id, "blockerId", "blockedId", "createdAt") VALUES
      ('block-outgoing', 'actor', 'blocked', '2026-10-07 12:00:00'),
      ('block-incoming', 'blocker', 'actor', '2026-10-07 11:00:00'),
      ('block-reciprocal', 'blocked', 'actor', '2026-10-07 10:00:00'),
      ('block-deleted', 'actor', 'deleted', '2026-10-07 09:00:00');
    INSERT INTO public."UserEmailAddress" (id, "userId", email) VALUES
      ('address-old', 'actor', 'old@example.com'),
      ('address-safe', 'actor', 'safe@example.com'),
      ('address-retired', 'actor', 'retired@example.com');
  `);
  await database.exec(migration);
  return database;
}

async function asOwner(database, userId, sql, params = []) {
  await database.exec("BEGIN");
  try {
    await database.exec("SET LOCAL ROLE grainline_app_runtime");
    await database.query(
      "SELECT set_config('app.user_id', $1, true)",
      [userId],
    );
    return await database.query(sql, params);
  } finally {
    await database.exec("ROLLBACK");
  }
}

describe("User block and email authority PostgreSQL proof", () => {
  it("returns deduplicated reciprocal block targets and active seller ids", async () => {
    const database = await createDatabase();
    try {
      const result = await asOwner(
        database,
        "actor",
        'SELECT * FROM public.grainline_user_block_targets()',
      );
      assert.deepEqual(result.rows, [
        { userId: "blocked", sellerProfileId: "seller-blocked" },
        { userId: "blocker", sellerProfileId: "seller-blocker" },
      ]);
    } finally {
      await database.close();
    }
  });

  it("keeps the blocked-account page owner-bound, ordered, and limited to outgoing blocks", async () => {
    const database = await createDatabase();
    try {
      const result = await asOwner(
        database,
        "actor",
        'SELECT * FROM public.grainline_user_blocked_account_page()',
      );
      assert.deepEqual(result.rows.map((row) => row.blockId), [
        "block-outgoing",
        "block-deleted",
      ]);
      assert.deepEqual(result.rows[0], {
        blockId: "block-outgoing",
        blockedId: "blocked",
        name: "Blocked User",
        imageUrl: "https://example.test/blocked.png",
        sellerDisplayName: "Blocked Maker",
        sellerAvatarImageUrl: "https://example.test/maker.png",
      });
    } finally {
      await database.close();
    }
  });

  it("returns only owner email fallbacks not claimed by another nondeleted account", async () => {
    const database = await createDatabase();
    try {
      const result = await asOwner(
        database,
        "actor",
        'SELECT * FROM public.grainline_user_email_fallback_addresses()',
      );
      assert.deepEqual(result.rows, [
        { email: "retired@example.com" },
        { email: "safe@example.com" },
      ]);
    } finally {
      await database.close();
    }
  });

  it("returns the exact sorted mutation pair and rejects self-targeting", async () => {
    const database = await createDatabase();
    try {
      const result = await asOwner(
        database,
        "actor",
        'SELECT id, "deletedAt" FROM public.grainline_user_block_pair_lock($1)',
        ["blocked"],
      );
      assert.deepEqual(result.rows, [
        { id: "actor", deletedAt: null },
        { id: "blocked", deletedAt: null },
      ]);
      await assert.rejects(
        asOwner(
          database,
          "actor",
          'SELECT * FROM public.grainline_user_block_pair_lock($1)',
          ["actor"],
        ),
        /User block pair input is invalid/,
      );
    } finally {
      await database.close();
    }
  });

  it("requires owner context, denies direct table reads, and exposes no function to PUBLIC", async () => {
    const database = await createDatabase();
    try {
      await assert.rejects(
        database.query('SELECT * FROM public.grainline_user_block_targets()'),
        /User block owner context is invalid/,
      );
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
             'grainline_user_block_targets',
             'grainline_user_blocked_account_page',
             'grainline_user_block_pair_lock',
             'grainline_user_email_fallback_addresses'
           ]::text[])
      `);
      assert.deepEqual(privileges.rows[0], {
        function_count: 4,
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
