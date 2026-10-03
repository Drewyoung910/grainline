import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  COMMISSION_LOCATION_MIN_PRIVACY_RADIUS_METERS,
  coarsePublicLocationPoint,
  commissionDistanceBucket,
  isSupportedLocationPoint,
  privacySafeLocationPoint,
  publicSellerLocationPoint,
} from "../src/lib/locationPrivacy.ts";

function source(path) {
  return readFileSync(path, "utf8");
}

function haversineMeters(a, b) {
  const radians = (value) => value * Math.PI / 180;
  const latDelta = radians(b.lat - a.lat);
  const lngDelta = radians(b.lng - a.lng);
  const value = Math.sin(latDelta / 2) ** 2
    + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(lngDelta / 2) ** 2;
  return 6_371_000 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(1 - value));
}

describe("public location projection", () => {
  it("maps radius-protected points to a stable many-to-one cell inside the advertised area", () => {
    const raw = { lat: 30.2672, lng: -97.7431 };
    const radiusMeters = 1_609.344;
    const first = privacySafeLocationPoint({ ...raw, radiusMeters });
    const second = privacySafeLocationPoint({ ...raw, radiusMeters });

    assert.deepEqual(first, second);
    assert.equal(first.approximate, true);
    assert.notDeepEqual({ lat: first.lat, lng: first.lng }, raw);
    assert.ok(haversineMeters(raw, first) < radiusMeters);

    const sameCell = privacySafeLocationPoint({
      lat: raw.lat + 0.0001,
      lng: raw.lng + 0.0001,
      radiusMeters,
    });
    assert.deepEqual(first, sameCell);
  });

  it("retains the explicit exact-point behavior when no privacy radius is selected", () => {
    const raw = { lat: 30.2672, lng: -97.7431 };
    assert.deepEqual(
      privacySafeLocationPoint({ ...raw, radiusMeters: 0 }),
      { ...raw, approximate: false },
    );
  });

  it("coarsens public discovery unless exact-location consent is explicit", () => {
    const first = coarsePublicLocationPoint({ lat: 30.251, lng: -97.749 });
    const sameCell = coarsePublicLocationPoint({ lat: 30.274, lng: -97.726 });
    assert.deepEqual(first, sameCell);
    assert.deepEqual(
      coarsePublicLocationPoint({ lat: 30.251, lng: -97.749, exactLocationOptIn: true }),
      { lat: 30.251, lng: -97.749 },
    );
  });

  it("uses one canonical seller projection across every public surface", () => {
    const raw = { lat: 30.04995, lng: -97.35001 };
    const radiusMeters = 1609.344;
    assert.deepEqual(
      publicSellerLocationPoint({ ...raw, radiusMeters, exactLocationOptIn: true }),
      privacySafeLocationPoint({ ...raw, radiusMeters }),
    );
    assert.equal(
      publicSellerLocationPoint({ ...raw, radiusMeters: 0 }).approximate,
      true,
    );
    assert.deepEqual(
      publicSellerLocationPoint({ ...raw, radiusMeters: 0, exactLocationOptIn: true }),
      { ...raw, approximate: false },
    );
  });

  it("rejects out-of-range coordinates and keeps boundary projections in range", () => {
    assert.equal(isSupportedLocationPoint(90, 180), true);
    assert.equal(isSupportedLocationPoint(90.0001, 180), false);
    assert.throws(
      () => privacySafeLocationPoint({ lat: 91, lng: 0, radiusMeters: 1_000 }),
      /outside the supported range/,
    );
    const edge = coarsePublicLocationPoint({ lat: 90, lng: 180 });
    assert.ok(edge.lat <= 90 && edge.lat >= -90);
    assert.ok(edge.lng <= 180 && edge.lng >= -180);
  });

  it("uses coarse commission distance bands instead of whole-mile precision", () => {
    assert.equal(COMMISSION_LOCATION_MIN_PRIVACY_RADIUS_METERS, 5_000);
    assert.equal(commissionDistanceBucket(0), "Within 10 mi");
    assert.equal(commissionDistanceBucket(10 * 1609.344), "10–25 mi away");
    assert.equal(commissionDistanceBucket(25 * 1609.344), "25–50 mi away");
    assert.equal(commissionDistanceBucket(50 * 1609.344), null);
    assert.equal(commissionDistanceBucket(Number.NaN), null);
  });
});

describe("public location source boundaries", () => {
  it("projects seller and listing coordinates before the client component boundary", () => {
    const listing = source("src/app/listing/[id]/page.tsx");
    const seller = source("src/app/seller/[id]/page.tsx");
    const mapCard = source("src/components/MapCard.tsx");

    for (const page of [listing, seller]) {
      assert.match(page, /publicSellerLocationPoint\(/);
      assert.match(page, /isSupportedLocationPoint\(lat, lng\)/);
      assert.match(page, /exactLocationOptIn: .*publicMapOptIn/);
      assert.match(page, /showPickupMap && pickupMapPoint &&/);
      assert.match(page, /displayLat=\{pickupMapPoint\.lat\}/);
      assert.match(page, /displayLng=\{pickupMapPoint\.lng\}/);
      assert.doesNotMatch(page, /<DynamicMapCard[\s\S]{0,120}\blat=\{lat\}/);
      assert.doesNotMatch(page, /<DynamicMapCard[\s\S]{0,120}\blng=\{lng\}/);
    }

    assert.match(mapCard, /displayLat: number/);
    assert.match(mapCard, /displayLng: number/);
    assert.doesNotMatch(mapCard, /jitterAround|seededRand|Math\.random|\bseed\??:/);
  });

  it("evaluates anonymous browse membership against a coarse public point", () => {
    const browse = source("src/app/browse/page.tsx");
    assert.match(browse, /sp\."publicMapOptIn" = true AND COALESCE\(sp\."radiusMeters", 0\) = 0/);
    assert.match(browse, /publicLatSql/);
    assert.match(browse, /publicLngSql/);
    assert.match(browse, /PUBLIC_LOCATION_GRID_CELLS_PER_DEGREE/);
    assert.match(browse, /PUBLIC_LOCATION_METERS_PER_DEGREE/);
    assert.match(browse, /WHEN COALESCE\(sp\."radiusMeters", 0\) > 0/);
    assert.match(browse, /radiusLatSql/);
    assert.match(browse, /radiusLngSql/);
    assert.match(browse, /gridCellCenterSql/);
    assert.match(browse, /sp\.lat BETWEEN -90 AND 90/);
    assert.match(browse, /sp\.lng BETWEEN -180 AND 180/);
    assert.match(browse, /LEAST\(89\.975, GREATEST\(-89\.975,/);
    assert.match(browse, /LEAST\(179\.975, GREATEST\(-179\.975,/);
    assert.doesNotMatch(browse, /radians\(\(sp\.lat::float -/);
    assert.doesNotMatch(browse, /radians\(\(sp\.lng::float -/);
  });

  it("coarsens new and historical commission locations before public discovery", () => {
    const route = source("src/app/api/commission/route.ts");
    const page = source("src/app/commission/page.tsx");

    assert.match(route, /userClerkCommissionContext\(prisma, userId\)/);
    assert.match(route, /me\.sellerProfile\?\.radiusMeters/);
    assert.match(route, /COMMISSION_LOCATION_MIN_PRIVACY_RADIUS_METERS/);
    assert.match(route, /privacySafeLocationPoint\(/);
    assert.match(route, /lat: reqLat,\s+lng: reqLng/);
    assert.match(route, /findOrCreateMetro\(metroSourceLat, metroSourceLng\)/);
    assert.doesNotMatch(route, /reqLat = Number\(sellerLat\)/);
    assert.doesNotMatch(route, /reqLng = Number\(sellerLng\)/);

    assert.ok((page.match(/floor\(cr\.lat::float8 \* 20\.0\)/g) ?? []).length >= 3);
    assert.ok((page.match(/floor\(cr\.lng::float8 \* 20\.0\)/g) ?? []).length >= 3);
    assert.ok((page.match(/LEAST\(89\.975, GREATEST\(-89\.975,/g) ?? []).length >= 3);
    assert.ok((page.match(/LEAST\(179\.975, GREATEST\(-179\.975,/g) ?? []).length >= 3);
    assert.match(page, /commissionDistanceBucket\(r\.distanceMeters\)/);
    assert.doesNotMatch(page, /Math\.round\(r\.distanceMeters \/ 1609\)/);
    assert.doesNotMatch(page, /cr\.lat, cr\.lng, cr\."isNational"/);
    assert.doesNotMatch(page, /\blat: true,\s+lng: true,\s+isNational: true/);
  });
});
