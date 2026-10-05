import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261004050000_prepare_user_public_seller_state/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      "imageUrl" varchar(2048)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE
        REFERENCES public."User"(id) ON DELETE CASCADE
    );
    INSERT INTO public."User" (id, banned, "deletedAt", "imageUrl") VALUES
      ('active', false, NULL, 'https://example.test/active.png'),
      ('banned', true, NULL, 'https://example.test/banned.png'),
      ('deleted', false, '2026-10-01', NULL);
    INSERT INTO public."SellerProfile" (id, "userId") VALUES
      ('seller-active', 'active'),
      ('seller-banned', 'banned'),
      ('seller-deleted', 'deleted');
  `);
  await database.exec(migration);
  return database;
}

async function sellerState(database, sellerId) {
  const result = await database.query(
    `SELECT "ownerAccountActive", "ownerImageUrl"
       FROM public."SellerProfile"
      WHERE id = $1`,
    [sellerId],
  );
  return result.rows[0];
}

describe("User public seller-state PostgreSQL proof", () => {
  it("backfills and follows User lifecycle and image changes", async () => {
    const database = await createDatabase();
    try {
      assert.deepEqual(await sellerState(database, "seller-active"), {
        ownerAccountActive: true,
        ownerImageUrl: "https://example.test/active.png",
      });
      assert.equal((await sellerState(database, "seller-banned")).ownerAccountActive, false);
      assert.equal((await sellerState(database, "seller-deleted")).ownerAccountActive, false);

      await database.exec(`
        UPDATE public."User"
           SET banned = true,
               "imageUrl" = 'https://example.test/replaced.png'
         WHERE id = 'active';
      `);
      assert.deepEqual(await sellerState(database, "seller-active"), {
        ownerAccountActive: false,
        ownerImageUrl: "https://example.test/replaced.png",
      });

      await database.exec(`
        UPDATE public."User"
           SET banned = false,
               "deletedAt" = NULL
         WHERE id = 'active';
      `);
      assert.equal((await sellerState(database, "seller-active")).ownerAccountActive, true);
    } finally {
      await database.close();
    }
  });

  it("binds inserts and rebinds to authoritative User state", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        INSERT INTO public."User" (id, banned, "deletedAt", "imageUrl")
        VALUES ('new-owner', false, NULL, 'https://example.test/new.png');
        INSERT INTO public."SellerProfile" (
          id,
          "userId",
          "ownerAccountActive",
          "ownerImageUrl"
        ) VALUES (
          'seller-new',
          'new-owner',
          false,
          'https://attacker.invalid/override.png'
        );
      `);
      assert.deepEqual(await sellerState(database, "seller-new"), {
        ownerAccountActive: true,
        ownerImageUrl: "https://example.test/new.png",
      });

      await database.exec(`
        UPDATE public."SellerProfile"
           SET "ownerAccountActive" = false,
               "ownerImageUrl" = 'https://attacker.invalid/override.png'
         WHERE id = 'seller-new';
      `);
      assert.deepEqual(await sellerState(database, "seller-new"), {
        ownerAccountActive: true,
        ownerImageUrl: "https://example.test/new.png",
      });

      await database.exec(`
        DELETE FROM public."SellerProfile" WHERE id = 'seller-banned';
        UPDATE public."SellerProfile"
           SET "userId" = 'banned'
         WHERE id = 'seller-new';
      `);
      assert.deepEqual(await sellerState(database, "seller-new"), {
        ownerAccountActive: false,
        ownerImageUrl: "https://example.test/banned.png",
      });
    } finally {
      await database.close();
    }
  });

  it("does not expose either trigger function to PUBLIC", async () => {
    const database = await createDatabase();
    try {
      const privileges = await database.query(`
        SELECT COUNT(*)::int AS public_execute_count
          FROM pg_catalog.pg_proc AS procedure
          CROSS JOIN LATERAL pg_catalog.aclexplode(
            COALESCE(
              procedure.proacl,
              pg_catalog.acldefault('f', procedure.proowner)
            )
          ) AS acl
         WHERE procedure.oid IN (
           pg_catalog.to_regprocedure('grainline_seller_owner_public_state_bind()'),
           pg_catalog.to_regprocedure('grainline_user_public_seller_state_sync()')
         )
           AND acl.grantee = 0
           AND acl.privilege_type = 'EXECUTE'
      `);
      assert.equal(privileges.rows[0].public_execute_count, 0);
    } finally {
      await database.close();
    }
  });
});
