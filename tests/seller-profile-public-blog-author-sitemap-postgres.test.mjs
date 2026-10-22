import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrationPath =
  "prisma/migrations/20261020235950_prepare_seller_profile_public_blog_author_sitemap/migration.sql";
const migration = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."BlogPostStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "displayName" varchar(100) NOT NULL,
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."BlogPost" (
      id text PRIMARY KEY,
      "sellerProfileId" text REFERENCES public."SellerProfile"(id),
      status public."BlogPostStatus" NOT NULL DEFAULT 'DRAFT',
      "publishedAt" timestamp without time zone,
      "updatedAt" timestamp without time zone NOT NULL,
      "authorAccountActive" boolean NOT NULL DEFAULT false
    );
    INSERT INTO public."SellerProfile" (
      id, "displayName", "ownerAccountActive", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('newer', 'Newer Author', true, true, true, false),
      ('older', 'Older Author', true, true, true, false),
      ('vacation', 'Vacation Author', true, true, true, true),
      ('unsupported', 'Unsupported Author', true, true, false, false);
    INSERT INTO public."BlogPost" (
      id, "sellerProfileId", status, "publishedAt", "updatedAt", "authorAccountActive"
    ) VALUES
      ('newer-1', 'newer', 'PUBLISHED', '2026-10-18 12:00:00', '2026-10-20 10:00:00', true),
      ('newer-2', 'newer', 'PUBLISHED', '2026-10-18 12:00:00', '2026-10-19 10:00:00', true),
      ('older-1', 'older', 'PUBLISHED', '2026-10-18 12:00:00', '2026-10-18 10:00:00', true),
      ('vacation-1', 'vacation', 'PUBLISHED', '2026-10-18 12:00:00', '2026-10-21 10:00:00', true),
      ('unsupported-1', 'unsupported', 'PUBLISHED', '2026-10-18 12:00:00', '2026-10-21 09:00:00', true),
      ('future-1', 'older', 'PUBLISHED', CURRENT_TIMESTAMP + INTERVAL '1 day', '2026-10-21 08:00:00', true),
      ('staff-1', NULL, 'PUBLISHED', '2026-10-18 12:00:00', '2026-10-21 07:00:00', true);
  `);
  if (migration) await database.exec(migration);
  return database;
}

test("blog-author sitemap returns each eligible seller once in latest-post order", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT id, "displayName", "updatedAt"
        FROM public.grainline_seller_public_blog_author_sitemap(500,100)
    `)).rows.map((row) => ({
      ...row,
      updatedAt: row.updatedAt.toISOString(),
    }));
    assert.deepEqual(rows, [
      { id: "newer", displayName: "Newer Author", updatedAt: "2026-10-20T10:00:00.000Z" },
      { id: "older", displayName: "Older Author", updatedAt: "2026-10-18T10:00:00.000Z" },
    ]);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("blog-author sitemap grants only the runtime role", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_blog_author_sitemap(501,100)"),
      (error) => error?.code === "22023",
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_blog_author_sitemap(500,100)"),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
