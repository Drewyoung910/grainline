import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { listingDomainPreparationMigrationPath } from "./helpers/listing-domain-preparation-migration-path.mjs";

const migration = readFileSync(
  "prisma/migrations/20261020160000_prepare_seller_profile_owner_featured_listing_toggle/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerOwnerPrivateAccess.ts", "utf8");
const page = readFileSync("src/app/dashboard/profile/page.tsx", "utf8");
const provision = readFileSync("scripts/provision-runtime-db-role.sql", "utf8");
const listingPreparation = readFileSync(
  listingDomainPreparationMigrationPath(),
  "utf8",
);

function reviewedToggleSql() {
  const start = listingPreparation.indexOf(
    "CREATE OR REPLACE FUNCTION public.grainline_seller_owner_featured_listing_toggle(",
  );
  const endMarker = "  TO grainline_app_runtime;";
  const end = listingPreparation.indexOf(endMarker, start);
  assert.ok(start >= 0 && end > start, "reviewed featured-listing toggle is missing");
  return listingPreparation.slice(start, end + endMarker.length);
}

test("owner featured-listing toggles are actor-bound and atomic", () => {
  assert.match(migration, /current_setting\('app\.user_id', true\)/u);
  assert.match(migration, /FOR UPDATE OF seller/u);
  assert.match(migration, /listing\."sellerId" = p_seller_profile_id/u);
  assert.match(migration, /FOR KEY SHARE OF listing/u);
  assert.match(migration, /cardinality\(source_featured_ids\) >= 6/u);
  assert.match(migration, /SET search_path = pg_catalog/u);
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime/u,
  );
  assert.match(migration, /GRANT EXECUTE ON FUNCTION[\s\S]*TO grainline_app_runtime/u);
  assert.match(access, /withDbUserContext\(userId/u);
  assert.match(access, /grainline_seller_owner_featured_listing_toggle/u);
  assert.doesNotMatch(access, /sellerOwnerFeaturedListingIds/u);
  assert.doesNotMatch(access, /updateSellerOwnerFeaturedListingIds/u);
  assert.match(page, /toggleSellerOwnerFeaturedListing\(seller\.userId/u);
  assert.doesNotMatch(page, /tx\.listing\.count/u);
  assert.equal(
    [...provision.matchAll(/grainline_seller_owner_featured_listing_toggle/g)].length,
    2,
    "runtime-role reprovisioning must revoke then restore only the reviewed EXECUTE grant",
  );
});

test("owner can remove a hard-deleted stale featured id without admitting a missing id", async () => {
  const database = new PGlite();
  try {
    await database.exec(`
      CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
      CREATE ROLE grainline_staff_read_runtime LOGIN NOINHERIT;
      CREATE TABLE public."User" (
        id text PRIMARY KEY,
        banned boolean NOT NULL DEFAULT false,
        "deletedAt" timestamp(3)
      );
      CREATE TABLE public."SellerProfile" (
        id text PRIMARY KEY,
        "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
        "featuredListingIds" text[] NOT NULL DEFAULT ARRAY[]::text[],
        "updatedAt" timestamp(3) NOT NULL DEFAULT now()
      );
      CREATE TABLE public."Listing" (
        id text PRIMARY KEY,
        "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id)
      );
      INSERT INTO public."User" (id) VALUES ('owner-user');
      INSERT INTO public."SellerProfile" (
        id, "userId", "featuredListingIds"
      ) VALUES (
        'seller-1', 'owner-user', ARRAY['hard-deleted-listing']::text[]
      );
      INSERT INTO public."Listing" (id, "sellerId")
      VALUES ('live-listing', 'seller-1');
      GRANT SELECT ON public."SellerProfile" TO grainline_app_runtime;
    `);
    await database.exec(reviewedToggleSql());

    await database.query("SELECT set_config('app.user_id', 'owner-user', false)");
    const toggleAsRuntime = async (listingId) => {
      await database.exec("SET SESSION AUTHORIZATION grainline_app_runtime");
      try {
        return (await database.query(`
          SELECT * FROM public.grainline_seller_owner_featured_listing_toggle(
            'seller-1', $1
          )
        `, [listingId])).rows;
      } finally {
        await database.exec("RESET SESSION AUTHORIZATION");
      }
    };
    const removed = await toggleAsRuntime("hard-deleted-listing");
    assert.deepEqual(removed, [{ applied: true, featured: false }]);
    assert.deepEqual(
      (await database.query(`
        SELECT "featuredListingIds" FROM public."SellerProfile"
         WHERE id = 'seller-1'
      `)).rows,
      [{ featuredListingIds: [] }],
    );

    assert.deepEqual(
      await toggleAsRuntime("missing-listing"),
      [{ applied: false, featured: false }],
    );
    assert.deepEqual(
      await toggleAsRuntime("live-listing"),
      [{ applied: true, featured: true }],
    );
  } finally {
    await database.exec("RESET SESSION AUTHORIZATION").catch(() => {});
    await database.close();
  }
});

test("preparation prevents new public rows from retaining reservation routing", () => {
  assert.match(
    listingPreparation,
    /ADD CONSTRAINT "Listing_public_reservation_routing_chk"[\s\S]*"isPrivate"[\s\S]*"reservedForUserId" IS NULL[\s\S]*"customOrderConversationId" IS NULL[\s\S]*NOT VALID/u,
  );
  assert.doesNotMatch(
    listingPreparation,
    /VALIDATE CONSTRAINT "Listing_public_reservation_routing_chk"/u,
    "historical rows must be inventoried before activation validates the guard",
  );
});

test("public reservation guard preserves legacy inventory but rejects new drift", async () => {
  const database = new PGlite();
  const marker = 'ALTER TABLE public."Listing"\n  ADD CONSTRAINT "Listing_public_reservation_routing_chk"';
  const start = listingPreparation.indexOf(marker);
  const end = listingPreparation.indexOf(";", start);
  assert.ok(start >= 0 && end > start, "public reservation guard SQL is missing");
  try {
    await database.exec(`
      CREATE TABLE public."Listing" (
        id text PRIMARY KEY,
        "isPrivate" boolean NOT NULL DEFAULT false,
        "reservedForUserId" text,
        "customOrderConversationId" text
      );
      INSERT INTO public."Listing" (
        id, "isPrivate", "reservedForUserId", "customOrderConversationId"
      ) VALUES ('legacy-drift', false, 'buyer-1', 'conversation-1');
    `);
    await database.exec(listingPreparation.slice(start, end + 1));
    assert.deepEqual(
      (await database.query('SELECT id FROM public."Listing" ORDER BY id')).rows,
      [{ id: "legacy-drift" }],
    );
    await assert.rejects(
      database.exec(`
        INSERT INTO public."Listing" (
          id, "isPrivate", "reservedForUserId", "customOrderConversationId"
        ) VALUES ('new-drift', false, 'buyer-2', 'conversation-2')
      `),
      /Listing_public_reservation_routing_chk/u,
    );
    await database.exec(`
      INSERT INTO public."Listing" (
        id, "isPrivate", "reservedForUserId", "customOrderConversationId"
      ) VALUES
        ('public-safe', false, NULL, NULL),
        ('private-reserved', true, 'buyer-2', 'conversation-2')
    `);
  } finally {
    await database.close();
  }
});
