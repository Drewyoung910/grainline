import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const mapMigration = readFileSync(
  "prisma/migrations/20261019010000_prepare_seller_profile_public_map_authority/migration.sql",
  "utf8",
);
const locationMigration = readFileSync(
  "prisma/migrations/20261019020000_prepare_seller_profile_public_location_authority/migration.sql",
  "utf8",
);
const browseMigration = readFileSync(
  "prisma/migrations/20261019030000_prepare_seller_profile_public_browse_authority/migration.sql",
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
      "userId" text NOT NULL UNIQUE REFERENCES public."User"(id),
      "ownerAccountActive" boolean NOT NULL DEFAULT false,
      "displayName" varchar(100) NOT NULL,
      city varchar(100),
      state varchar(50),
      lat double precision,
      lng double precision,
      "radiusMeters" integer,
      "publicMapOptIn" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT false,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "allowLocalPickup" boolean NOT NULL DEFAULT true
    );
    CREATE TABLE public."Block" (
      id text PRIMARY KEY,
      "blockerId" text NOT NULL REFERENCES public."User"(id),
      "blockedId" text NOT NULL REFERENCES public."User"(id)
    );
    CREATE TABLE public."Listing" (
      id text PRIMARY KEY,
      "sellerId" text NOT NULL REFERENCES public."SellerProfile"(id),
      status text NOT NULL,
      "isPrivate" boolean NOT NULL DEFAULT false,
      "reservedForUserId" text REFERENCES public."User"(id),
      "archivedAt" timestamp(3)
    );
    GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public."SellerProfile"
      TO grainline_app_runtime;
    INSERT INTO public."User" (id) VALUES
      ('viewer'), ('owner-visible'), ('owner-blocked'), ('owner-radius'),
      ('owner-no-opt-in'), ('owner-vacation'), ('owner-invalid'),
      ('owner-only');
    INSERT INTO public."SellerProfile" (
      id, "userId", "ownerAccountActive", "displayName", city, state,
      lat, lng, "radiusMeters", "publicMapOptIn", "chargesEnabled",
      "stripeAccountSupported", "vacationMode"
    ) VALUES
      ('seller-visible', 'owner-visible', true, 'Visible Workshop', 'Austin', 'TX',
       30.251, -97.749, 0, true, true, true, false),
      ('seller-blocked', 'owner-blocked', true, 'Blocked Workshop', 'Dallas', 'TX',
       32.781, -96.799, NULL, true, true, true, false),
      ('seller-radius', 'owner-radius', true, 'Radius Workshop', 'Houston', 'TX',
       29.760, -95.369, 5000, true, true, true, false),
      ('seller-no-opt-in', 'owner-no-opt-in', true, 'Private Workshop', 'Waco', 'TX',
       31.549, -97.147, 0, false, true, true, false),
      ('seller-vacation', 'owner-vacation', true, 'Vacation Workshop', 'El Paso', 'TX',
       31.761, -106.485, 0, true, true, true, true),
      ('seller-invalid', 'owner-invalid', true, 'Invalid Workshop', 'Nowhere', 'TX',
       999, -97.749, 0, true, true, true, false),
      ('seller-owner-only', 'owner-only', false, 'Owner Workshop', 'Austin', 'TX',
       30.251, -97.749, 0, false, false, true, false);
    INSERT INTO public."Listing" (
      id, "sellerId", status, "isPrivate", "reservedForUserId", "archivedAt"
    ) VALUES
      ('listing-public', 'seller-visible', 'ACTIVE', false, NULL, NULL),
      ('listing-private-viewer', 'seller-visible', 'ACTIVE', true, 'viewer', NULL),
      ('listing-private-other', 'seller-visible', 'ACTIVE', true, 'owner-blocked', NULL),
      ('listing-owner-draft', 'seller-owner-only', 'DRAFT', false, NULL, NULL),
      ('listing-archived', 'seller-visible', 'ACTIVE', false, NULL, NOW()),
      ('listing-blocked-public', 'seller-blocked', 'ACTIVE', false, NULL, NULL),
      ('listing-radius-public', 'seller-radius', 'ACTIVE', false, NULL, NULL),
      ('listing-no-opt-in-public', 'seller-no-opt-in', 'ACTIVE', false, NULL, NULL);
    INSERT INTO public."Block" (id, "blockerId", "blockedId")
      VALUES ('block-1', 'owner-blocked', 'viewer');
  `);
  await database.exec(mapMigration);
  await database.exec(locationMigration);
  await database.exec(browseMigration);
  return database;
}

test("public map authority returns bounded approximate active-seller rows", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT * FROM public.grainline_seller_public_map_points(500)
    `)).rows;
    assert.deepEqual(rows, [
      {
        id: "seller-blocked",
        displayName: "Blocked Workshop",
        city: "Dallas",
        state: "TX",
        publicLat: 32.775,
        publicLng: -96.775,
      },
      {
        id: "seller-visible",
        displayName: "Visible Workshop",
        city: "Austin",
        state: "TX",
        publicLat: 30.275,
        publicLng: -97.725,
      },
    ]);
    assert.deepEqual(
      Object.keys(rows[0]).sort(),
      ["city", "displayName", "id", "publicLat", "publicLng", "state"].sort(),
    );

    // Preparation is additive; the predecessor table grant is intentionally
    // unchanged until the later zero-direct activation release.
    assert.equal(
      (await database.query('SELECT count(*)::integer AS count FROM public."SellerProfile"')).rows[0].count,
      7,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("resource-bound location authority returns only approximate presentation fields", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const sellerRows = (await database.query(`
      SELECT *
        FROM public.grainline_seller_public_location('seller-visible', NULL)
    `)).rows;
    assert.deepEqual(sellerRows, [{
      publicLat: 30.275,
      publicLng: -97.725,
      displayRadiusMeters: null,
      structuredGeoEligible: true,
    }]);
    assert.deepEqual(
      Object.keys(sellerRows[0]).sort(),
      ["displayRadiusMeters", "publicLat", "publicLng", "structuredGeoEligible"].sort(),
    );

    const listingRows = (await database.query(`
      SELECT *
        FROM public.grainline_seller_public_location(
          'seller-visible',
          'listing-public'
        )
    `)).rows;
    assert.deepEqual(listingRows, sellerRows);

    const radiusRows = (await database.query(`
      SELECT *
        FROM public.grainline_seller_public_location('seller-radius', NULL)
    `)).rows;
    assert.equal(radiusRows.length, 1);
    assert.ok(Math.abs(radiusRows[0].publicLat - 29.76733740567734) < 1e-10);
    assert.ok(Math.abs(radiusRows[0].publicLng - (-95.35662953647143)) < 1e-10);
    assert.equal(radiusRows[0].displayRadiusMeters, 5000);
    assert.equal(radiusRows[0].structuredGeoEligible, false);

    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_public_location(
          'seller-visible',
          'listing-private-viewer'
        )
    `)).rows, []);
    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_public_location(
          'seller-visible',
          'listing-archived'
        )
    `)).rows, []);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("resource-bound location authority preserves owner and reserved-buyer visibility", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.equal((await database.query(`
      SELECT count(*)::integer AS count
        FROM public.grainline_seller_public_location(
          'seller-visible',
          'listing-private-viewer'
        )
    `)).rows[0].count, 1);
    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_public_location(
          'seller-visible',
          'listing-private-other'
        )
    `)).rows, []);
    await database.exec("RESET ROLE");
    await database.exec("RESET app.user_id");

    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'owner-only', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.equal((await database.query(`
      SELECT count(*)::integer AS count
        FROM public.grainline_seller_public_location(
          'seller-owner-only',
          'listing-owner-draft'
        )
    `)).rows[0].count, 1);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.exec("RESET app.user_id").catch(() => {});
    await database.close();
  }
});

test("resource-bound location authority denies blocked and ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    assert.deepEqual((await database.query(`
      SELECT *
        FROM public.grainline_seller_public_location('seller-blocked', NULL)
    `)).rows, []);
    await database.exec("RESET ROLE");
    await database.exec("RESET app.user_id");

    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_location('seller-visible', NULL)",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.exec("RESET app.user_id").catch(() => {});
    await database.close();
  }
});

test("browse location authority filters on approximate points without disclosing them", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT *
        FROM public.grainline_seller_public_browse_nearby(30.2672, -97.7431, 500)
    `)).rows;
    assert.deepEqual(rows, [
      { sellerProfileId: "seller-blocked" },
      { sellerProfileId: "seller-no-opt-in" },
      { sellerProfileId: "seller-radius" },
      { sellerProfileId: "seller-visible" },
    ]);
    assert.deepEqual(Object.keys(rows[0]), ["sellerProfileId"]);
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_browse_nearby(30, -97, 501)",
      ),
      /input is invalid/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("browse location authority applies reciprocal blocks and denies ungranted callers", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT "sellerProfileId"
        FROM public.grainline_seller_public_browse_nearby(30.2672, -97.7431, 500)
    `)).rows;
    assert.equal(rows.some((row) => row.sellerProfileId === "seller-blocked"), false);
    assert.equal(rows.some((row) => row.sellerProfileId === "seller-visible"), true);
    await database.exec("RESET ROLE");
    await database.exec("RESET app.user_id");

    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(
        "SELECT * FROM public.grainline_seller_public_browse_nearby(30, -97, 25)",
      ),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.exec("RESET app.user_id").catch(() => {});
    await database.close();
  }
});

test("public map authority applies reciprocal blocks from trusted user context", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'viewer', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    const rows = (await database.query(`
      SELECT id FROM public.grainline_seller_public_map_points(500)
    `)).rows;
    assert.deepEqual(rows, [{ id: "seller-visible" }]);

    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_map_points(0)"),
      /limit is invalid/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.exec("RESET app.user_id").catch(() => {});
    await database.close();
  }
});

test("public map authority denies ungranted callers and invalid viewer contexts", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_map_points(500)"),
      /permission denied/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'missing-user', false)");
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.query("SELECT * FROM public.grainline_seller_public_map_points(500)"),
      /viewer context is invalid/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.exec("RESET app.user_id").catch(() => {});
    await database.close();
  }
});
