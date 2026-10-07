import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261007010000_prepare_user_public_blog_state/migration.sql",
  "utf8",
);

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      banned boolean NOT NULL DEFAULT false,
      "deletedAt" timestamp(3) without time zone,
      name varchar(100),
      "imageUrl" varchar(2048)
    );
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
      "displayName" varchar(100) NOT NULL,
      "avatarImageUrl" varchar(2048)
    );
    CREATE TABLE public."BlogPost" (
      id text PRIMARY KEY,
      "authorId" text REFERENCES public."User"(id) ON DELETE SET NULL
    );
    CREATE TABLE public."BlogComment" (
      id text PRIMARY KEY,
      "authorId" text NOT NULL REFERENCES public."User"(id) ON DELETE RESTRICT
    );
    INSERT INTO public."User" (id, banned, "deletedAt", name, "imageUrl") VALUES
      ('active', false, NULL, 'Active User', 'https://example.test/active.png'),
      ('banned', true, NULL, 'Banned User', 'https://example.test/banned.png'),
      ('plain', false, NULL, 'Plain User', NULL);
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", "avatarImageUrl"
    ) VALUES
      ('seller-active', 'active', 'Active Shop', 'https://example.test/shop.png'),
      ('seller-plain', 'plain', 'Plain Shop', NULL);
    INSERT INTO public."BlogPost" (id, "authorId") VALUES
      ('post-active', 'active'),
      ('post-banned', 'banned'),
      ('post-orphaned', NULL);
    INSERT INTO public."BlogComment" (id, "authorId") VALUES
      ('comment-active', 'active'),
      ('comment-banned', 'banned'),
      ('comment-plain-seller', 'plain');
  `);
  await database.exec(migration);
  return database;
}

async function postState(database, id) {
  const result = await database.query(
    `SELECT "authorId", "authorAccountActive", "authorName", "authorImageUrl",
            "authorSellerName", "authorSellerAvatarUrl"
       FROM public."BlogPost"
      WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

async function commentState(database, id) {
  const result = await database.query(
    `SELECT "authorId", "authorAccountActive", "authorName", "authorImageUrl",
            "authorSellerProfilePresent", "authorSellerAvatarUrl"
       FROM public."BlogComment"
      WHERE id = $1`,
    [id],
  );
  return result.rows[0];
}

describe("User public blog-state PostgreSQL proof", () => {
  it("backfills active, inactive, seller, and nullable-author state", async () => {
    const database = await createDatabase();
    try {
      assert.deepEqual(await postState(database, "post-active"), {
        authorId: "active",
        authorAccountActive: true,
        authorName: "Active User",
        authorImageUrl: "https://example.test/active.png",
        authorSellerName: "Active Shop",
        authorSellerAvatarUrl: "https://example.test/shop.png",
      });
      assert.equal((await postState(database, "post-banned")).authorAccountActive, false);
      assert.deepEqual(await postState(database, "post-orphaned"), {
        authorId: null,
        authorAccountActive: false,
        authorName: null,
        authorImageUrl: null,
        authorSellerName: null,
        authorSellerAvatarUrl: null,
      });
      assert.equal((await commentState(database, "comment-active")).authorAccountActive, true);
      assert.equal((await commentState(database, "comment-banned")).authorAccountActive, false);
      assert.deepEqual(await commentState(database, "comment-plain-seller"), {
        authorId: "plain",
        authorAccountActive: true,
        authorName: "Plain User",
        authorImageUrl: null,
        authorSellerProfilePresent: true,
        authorSellerAvatarUrl: null,
      });
    } finally {
      await database.close();
    }
  });

  it("synchronizes User and seller identity changes in the writing transaction", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        UPDATE public."User"
           SET banned = true,
               name = 'Renamed User',
               "imageUrl" = 'https://example.test/renamed.png'
         WHERE id = 'active';
        UPDATE public."SellerProfile"
           SET "displayName" = 'Renamed Shop',
               "avatarImageUrl" = 'https://example.test/renamed-shop.png'
         WHERE "userId" = 'active';
      `);
      const post = await postState(database, "post-active");
      assert.equal(post.authorAccountActive, false);
      assert.equal(post.authorName, "Renamed User");
      assert.equal(post.authorImageUrl, "https://example.test/renamed.png");
      assert.equal(post.authorSellerName, "Renamed Shop");
      assert.equal(post.authorSellerAvatarUrl, "https://example.test/renamed-shop.png");
      const comment = await commentState(database, "comment-active");
      assert.equal(comment.authorAccountActive, false);
      assert.equal(comment.authorName, "Renamed User");
      assert.equal(comment.authorSellerProfilePresent, true);
      assert.equal(comment.authorSellerAvatarUrl, "https://example.test/renamed-shop.png");

      await database.exec(`DELETE FROM public."SellerProfile" WHERE "userId" = 'active'`);
      assert.equal((await postState(database, "post-active")).authorSellerName, null);
      assert.equal((await commentState(database, "comment-active")).authorSellerProfilePresent, false);
      assert.equal((await commentState(database, "comment-active")).authorSellerAvatarUrl, null);
    } finally {
      await database.close();
    }
  });

  it("overwrites forged snapshots and binds new artifacts to source state", async () => {
    const database = await createDatabase();
    try {
      await database.exec(`
        UPDATE public."BlogPost"
           SET "authorAccountActive" = true,
               "authorName" = 'Forged',
               "authorImageUrl" = 'https://attacker.invalid/post.png',
               "authorSellerName" = 'Forged Shop'
         WHERE id = 'post-banned';
        UPDATE public."BlogComment"
           SET "authorAccountActive" = true,
               "authorName" = 'Forged',
               "authorImageUrl" = 'https://attacker.invalid/comment.png',
               "authorSellerProfilePresent" = true,
               "authorSellerAvatarUrl" = 'https://attacker.invalid/seller.png'
         WHERE id = 'comment-banned';
        INSERT INTO public."BlogPost" (
          id, "authorId", "authorAccountActive", "authorName"
        ) VALUES ('post-new', 'plain', false, 'Forged');
        INSERT INTO public."BlogComment" (
          id, "authorId", "authorAccountActive", "authorName"
        ) VALUES ('comment-new', 'plain', false, 'Forged');
      `);
      assert.equal((await postState(database, "post-banned")).authorAccountActive, false);
      assert.equal((await postState(database, "post-banned")).authorName, "Banned User");
      assert.equal((await commentState(database, "comment-banned")).authorAccountActive, false);
      assert.equal((await commentState(database, "comment-banned")).authorName, "Banned User");
      assert.equal((await commentState(database, "comment-banned")).authorSellerProfilePresent, false);
      assert.equal((await commentState(database, "comment-banned")).authorSellerAvatarUrl, null);
      assert.equal((await postState(database, "post-new")).authorName, "Plain User");
      assert.equal((await commentState(database, "comment-new")).authorName, "Plain User");

      await database.exec(`UPDATE public."BlogPost" SET "authorId" = NULL WHERE id = 'post-new'`);
      assert.deepEqual(await postState(database, "post-new"), {
        authorId: null,
        authorAccountActive: false,
        authorName: null,
        authorImageUrl: null,
        authorSellerName: null,
        authorSellerAvatarUrl: null,
      });

      await assert.rejects(
        database.exec(`UPDATE public."BlogPost" SET "authorId" = 'active' WHERE id = 'post-banned'`),
        /Blog post author cannot be rebound/,
      );
      await assert.rejects(
        database.exec(`UPDATE public."BlogComment" SET "authorId" = 'active' WHERE id = 'comment-banned'`),
        /Blog comment author cannot be rebound/,
      );
    } finally {
      await database.close();
    }
  });

  it("does not expose any trigger function to PUBLIC", async () => {
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
           pg_catalog.to_regprocedure('grainline_blog_post_author_public_state_bind()'),
           pg_catalog.to_regprocedure('grainline_blog_comment_author_public_state_bind()'),
           pg_catalog.to_regprocedure('grainline_user_public_blog_state_sync()'),
           pg_catalog.to_regprocedure('grainline_seller_public_blog_state_sync()')
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
