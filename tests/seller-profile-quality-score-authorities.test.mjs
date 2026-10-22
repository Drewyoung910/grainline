import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migration = readFileSync(
  "prisma/migrations/20261020235988_prepare_seller_profile_quality_score_authorities/migration.sql",
  "utf8",
);

async function readyDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TABLE public."SellerProfile" (
      id text PRIMARY KEY,
      "createdAt" timestamp NOT NULL,
      "guildLevel" text NOT NULL DEFAULT 'NONE',
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "ownerAccountActive" boolean NOT NULL DEFAULT false
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      description text NOT NULL,
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "viewCount" integer NOT NULL DEFAULT 0,
      "clickCount" integer NOT NULL DEFAULT 0,
      "aiReviewFlags" text[] NOT NULL DEFAULT '{}',
      "qualityScore" double precision NOT NULL DEFAULT 0,
      "createdAt" timestamp NOT NULL
    );
    CREATE TABLE public."Photo" (
      id text PRIMARY KEY,
      "listingId" text NOT NULL REFERENCES public."Listing"(id),
      "altText" text
    );
    CREATE TABLE public."SellerRatingSummary" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id),
      "averageRating" double precision NOT NULL DEFAULT 0,
      "reviewCount" integer NOT NULL DEFAULT 0
    );
    INSERT INTO public."SellerProfile"
      (id, "createdAt", "guildLevel", "chargesEnabled",
       "stripeAccountSupported", "vacationMode", "ownerAccountActive")
    VALUES
      ('eligible', '2026-10-01', 'GUILD_MEMBER', true, true, false, true),
      ('vacation', '2026-10-01', 'NONE', true, true, true, true);
    INSERT INTO public."SellerRatingSummary"
      ("sellerProfileId", "averageRating", "reviewCount")
    VALUES ('eligible', 4.5, 3);
    INSERT INTO public."Listing"
      (id, "sellerId", description, status, "isPrivate", "viewCount",
       "clickCount", "aiReviewFlags", "qualityScore", "createdAt")
    VALUES
      ('active-a', 'eligible', 'Detailed listing', 'ACTIVE', false, 9, 4,
       ARRAY['flag'], 0.4, '2026-10-20'),
      ('active-b', 'eligible', 'Second listing', 'ACTIVE', false, 3, 1,
       '{}', 0.3, '2026-10-21'),
      ('hidden', 'eligible', 'Hidden listing', 'HIDDEN', false, 0, 0,
       '{}', 0.6, '2026-10-20'),
      ('vacation-listing', 'vacation', 'Vacation listing', 'ACTIVE', false, 0, 0,
       '{}', 0.7, '2026-10-20');
    INSERT INTO public."Photo" (id, "listingId", "altText") VALUES
      ('photo-a', 'active-a', 'A useful description'),
      ('photo-b', 'active-a', NULL);
  `);
  await database.exec(migration);
  return database;
}

test("quality-score service authority returns bounded eligible batches", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
    const rows = (await database.query(
      "SELECT * FROM public.grainline_seller_service_quality_score_batch($1, $2)",
      [null, 1],
    )).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, "active-a");
    assert.equal(Number(rows[0].photoCount), 2);
    assert.equal(rows[0].hasAltText, true);
    assert.equal(rows[0].guildLevel, "GUILD_MEMBER");
    assert.equal(rows[0].sellerAvgRating, 4.5);
    assert.equal(Number(rows[0].sellerReviewCount), 3);

    const next = (await database.query(
      "SELECT * FROM public.grainline_seller_service_quality_score_batch($1, $2)",
      ["active-a", 200],
    )).rows;
    assert.deepEqual(next.map((row) => row.id), ["active-b"]);
    await database.exec("SET SESSION AUTHORIZATION postgres");
  } finally {
    await database.close();
  }
});

test("quality-score zeroing is atomic and restricted to the runtime service", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
    const result = (await database.query(
      "SELECT public.grainline_seller_service_quality_score_zero_ineligible() AS count",
    )).rows;
    assert.equal(Number(result[0].count), 2);
    await database.exec("SET SESSION AUTHORIZATION postgres");

    const scores = (await database.query(
      'SELECT id, "qualityScore" FROM public."Listing" ORDER BY id',
    )).rows;
    assert.deepEqual(scores.map((row) => [row.id, row.qualityScore]), [
      ["active-a", 0.4],
      ["active-b", 0.3],
      ["hidden", 0],
      ["vacation-listing", 0],
    ]);

    await database.exec("SET SESSION AUTHORIZATION grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_service_quality_score_batch(NULL, 1)"),
      /permission denied/u,
    );
    await assert.rejects(
      database.query("SELECT public.grainline_seller_service_quality_score_zero_ineligible()"),
      /permission denied/u,
    );
    await database.exec("RESET SESSION AUTHORIZATION");
  } finally {
    await database.close();
  }
});

test("quality-score application code uses only the bounded SellerProfile service authority", () => {
  const quality = readFileSync("src/lib/quality-score.ts", "utf8");
  const access = readFileSync("src/lib/sellerProfileQualityScoreAccess.ts", "utf8");

  assert.match(quality, /sellerServiceQualityScoreBatch\(cursorId, BATCH_SIZE\)/u);
  assert.match(quality, /sellerServiceZeroIneligibleQualityScores\(\)/u);
  assert.doesNotMatch(quality, /SellerProfile|seller:\s*\{|prisma\.listing\.updateMany/u);
  assert.match(access, /grainline_seller_service_quality_score_batch/u);
  assert.match(access, /grainline_seller_service_quality_score_zero_ineligible/u);
});
