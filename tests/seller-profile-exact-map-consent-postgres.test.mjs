import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { PGlite } from "@electric-sql/pglite";

const migrations = [
  "20261019010000_prepare_seller_profile_public_map_authority",
  "20261019020000_prepare_seller_profile_public_location_authority",
  "20261019030000_prepare_seller_profile_public_browse_authority",
  "20261020090000_prepare_seller_profile_exact_map_consent",
  "20261020210000_correct_seller_exact_map_consent_evidence",
].map((name) => readFileSync(`prisma/migrations/${name}/migration.sql`, "utf8"));

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
      "ownerAccountActive" boolean NOT NULL DEFAULT true,
      "displayName" varchar(100) NOT NULL,
      city varchar(100),
      state varchar(50),
      lat double precision,
      lng double precision,
      "radiusMeters" integer,
      "publicMapOptIn" boolean NOT NULL DEFAULT false,
      "chargesEnabled" boolean NOT NULL DEFAULT true,
      "stripeAccountSupported" boolean NOT NULL DEFAULT true,
      "vacationMode" boolean NOT NULL DEFAULT false,
      "allowLocalPickup" boolean NOT NULL DEFAULT true,
      "updatedAt" timestamp(3) NOT NULL DEFAULT '2026-10-20T00:00:00.000Z'
    );
    CREATE TABLE public."SellerProfilePrivate" (
      "sellerProfileId" text PRIMARY KEY REFERENCES public."SellerProfile"(id) ON DELETE CASCADE,
      "updatedAt" timestamp(3) NOT NULL DEFAULT '2026-10-20T00:00:00.000Z'
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
    CREATE FUNCTION public.grainline_seller_owner_shop_settings_update(
      p_user_id text, p_seller_profile_id text, p_city text, p_state text,
      p_lat double precision, p_lng double precision, p_radius_meters double precision,
      p_public_map_opt_in boolean, p_shipping_flat_rate_cents integer,
      p_free_shipping_over_cents integer, p_allow_local_pickup boolean,
      p_use_calculated_shipping boolean, p_preferred_carriers text[],
      p_ship_from_name text, p_ship_from_line1 text, p_ship_from_line2 text,
      p_ship_from_city text, p_ship_from_state text, p_ship_from_postal text,
      p_ship_from_country text, p_ship_from_phone text,
      p_default_pkg_length_cm double precision, p_default_pkg_width_cm double precision,
      p_default_pkg_height_cm double precision, p_default_pkg_weight_grams integer
    ) RETURNS text
    LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog
    AS $stub$
    BEGIN
      IF p_user_id IS DISTINCT FROM 'owner' OR p_seller_profile_id IS DISTINCT FROM 'seller' THEN
        RAISE EXCEPTION 'unavailable' USING ERRCODE = '42501';
      END IF;
      UPDATE public."SellerProfile"
         SET city = p_city, state = p_state, lat = p_lat, lng = p_lng,
             "radiusMeters" = p_radius_meters,
             "publicMapOptIn" = p_public_map_opt_in,
             "allowLocalPickup" = p_allow_local_pickup,
             "updatedAt" = pg_catalog.clock_timestamp() AT TIME ZONE 'UTC'
       WHERE id = p_seller_profile_id AND "userId" = p_user_id;
      RETURN p_seller_profile_id;
    END
    $stub$;
    REVOKE ALL ON TABLE public."SellerProfilePrivate" FROM PUBLIC;
    REVOKE ALL ON FUNCTION public.grainline_seller_owner_shop_settings_update(
      text, text, text, text, double precision, double precision, double precision,
      boolean, integer, integer, boolean, boolean, text[], text, text, text, text,
      text, text, text, text, double precision, double precision, double precision,
      integer
    ) FROM PUBLIC;
    GRANT EXECUTE ON FUNCTION public.grainline_seller_owner_shop_settings_update(
      text, text, text, text, double precision, double precision, double precision,
      boolean, integer, integer, boolean, boolean, text[], text, text, text, text,
      text, text, text, text, double precision, double precision, double precision,
      integer
    ) TO grainline_app_runtime;
  `);
  for (const migration of migrations) await database.exec(migration);
  await database.exec(`
    INSERT INTO public."User" (id) VALUES ('owner'), ('viewer');
    INSERT INTO public."SellerProfile" (
      id, "userId", "displayName", city, state, lat, lng,
      "radiusMeters", "publicMapOptIn"
    ) VALUES ('seller', 'owner', 'Exact Workshop', 'Austin', 'TX',
              30.251, -97.749, 0, true);
    INSERT INTO public."SellerProfilePrivate" ("sellerProfileId") VALUES ('seller');
    INSERT INTO public."Listing" (id, "sellerId", status)
      VALUES ('listing', 'seller', 'ACTIVE');
  `);
  return database;
}

const shopSettingsCall = (exactConsent) => `
  SELECT public.grainline_seller_owner_shop_settings_update(
    'owner', 'seller', 'Austin', 'TX', 30.251, -97.749, 0,
    true, ${exactConsent}, ${exactConsent ? "1, 30.251, -97.749" : "NULL, NULL, NULL"},
    NULL, NULL, true, false, ARRAY[]::text[],
    NULL, NULL, NULL, NULL, NULL, NULL, 'US', NULL,
    NULL, NULL, NULL, NULL
  ) AS id
`;

test("exact public location requires current versioned consent", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'owner', false)");
    let point = (await database.query(
      "SELECT * FROM public.grainline_seller_public_map_points(10)",
    )).rows[0];
    assert.deepEqual(
      { lat: point.publicLat, lng: point.publicLng },
      { lat: 30.275, lng: -97.725 },
      "an existing map opt-in must remain approximate",
    );

    assert.equal((await database.query(shopSettingsCall(true))).rows[0].id, "seller");
    point = (await database.query(
      "SELECT * FROM public.grainline_seller_public_map_points(10)",
    )).rows[0];
    assert.deepEqual(
      { lat: point.publicLat, lng: point.publicLng },
      { lat: 30.251, lng: -97.749 },
    );
    const location = (await database.query(
      "SELECT * FROM public.grainline_seller_public_location('seller', 'listing')",
    )).rows[0];
    assert.deepEqual(location, {
      publicLat: 30.251,
      publicLng: -97.749,
      displayRadiusMeters: null,
      structuredGeoEligible: true,
    });

    await database.exec("RESET ROLE");
    await database.exec(`
      UPDATE public."SellerProfile"
         SET "displayName" = 'Renamed Workshop'
       WHERE id = 'seller'
    `);
    await database.exec("SET ROLE grainline_app_runtime");
    point = (await database.query(
      "SELECT * FROM public.grainline_seller_public_map_points(10)",
    )).rows[0];
    assert.deepEqual(
      { lat: point.publicLat, lng: point.publicLng },
      { lat: 30.251, lng: -97.749 },
      "an ordinary shop rename must not withdraw exact-location consent",
    );
    await database.exec("RESET ROLE");
    assert.equal((await database.query(`
      SELECT count(*)::integer AS count
        FROM public."SellerExactMapConsentEvent"
       WHERE "sellerProfileId" = 'seller'
    `)).rows[0].count, 1);
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("coordinate and privacy changes revoke exact consent fail closed", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'owner', false)");
    await database.query(shopSettingsCall(true));
    await database.query(`
      SELECT public.grainline_seller_owner_shop_settings_update(
        'owner', 'seller', 'Austin', 'TX', 30.301, -97.699, 0,
        true, false, NULL, NULL, NULL, NULL, NULL, true, false, ARRAY[]::text[],
        NULL, NULL, NULL, NULL, NULL, NULL, 'US', NULL,
        NULL, NULL, NULL, NULL
      )
    `);
    await database.exec("RESET ROLE");
    const consent = (await database.query(`
      SELECT "publicMapExactConsentAt", "publicMapExactConsentVersion",
             "publicMapExactConsentCoordinateHash"
        FROM public."SellerProfilePrivate"
       WHERE "sellerProfileId" = 'seller'
    `)).rows[0];
    assert.deepEqual(consent, {
      publicMapExactConsentAt: null,
      publicMapExactConsentVersion: null,
      publicMapExactConsentCoordinateHash: null,
    });
    assert.deepEqual((await database.query(`
      SELECT "eventType", reason
        FROM public."SellerExactMapConsentEvent"
       WHERE "sellerProfileId" = 'seller'
       ORDER BY "createdAt", id
    `)).rows, [
      { eventType: "GRANTED", reason: null },
      { eventType: "WITHDRAWN", reason: "LOCATION_CHANGE" },
    ]);
    await database.exec("SET ROLE grainline_app_runtime");
    await database.exec("SELECT pg_catalog.set_config('app.user_id', 'owner', false)");
    const point = (await database.query(
      "SELECT * FROM public.grainline_seller_public_map_points(10)",
    )).rows[0];
    assert.notDeepEqual(
      { lat: point.publicLat, lng: point.publicLng },
      { lat: 30.301, lng: -97.699 },
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});

test("consent storage is not directly writable by runtime or untrusted roles", async () => {
  const database = await readyDatabase();
  try {
    await database.exec("SET ROLE grainline_app_runtime");
    await assert.rejects(
      database.exec(`UPDATE public."SellerProfilePrivate"
                        SET "publicMapExactConsentAt" = NOW(),
                            "publicMapExactConsentVersion" = 1`),
      /permission denied/u,
    );
    await assert.rejects(
      database.exec(`INSERT INTO public."SellerExactMapConsentEvent"
        (id, "sellerProfileId", "eventType", "consentTextVersion",
         "consentTextSha256", "coordinateHash", "createdAt")
       VALUES ('forged', 'seller', 'GRANTED', 1, repeat('0', 64),
               repeat('0', 64), NOW())`),
      /permission denied/u,
    );
    await database.exec("RESET ROLE");
    await database.exec("SET ROLE grainline_untrusted");
    await assert.rejects(
      database.query(shopSettingsCall(true)),
      /permission denied/u,
    );
  } finally {
    await database.exec("RESET ROLE").catch(() => {});
    await database.close();
  }
});
