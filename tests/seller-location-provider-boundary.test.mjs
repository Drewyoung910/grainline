import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  normalizeSellerLocationSearchQuery,
  sellerLocationPlaceToResult,
} from "../src/lib/sellerLocationSearchState.ts";

const locationPicker = readFileSync("src/components/LocationPicker.tsx", "utf8");
const reverseGeocode = readFileSync("src/lib/reverse-geocode.ts", "utf8");
const metroMapper = readFileSync("src/lib/geo-metro.ts", "utf8");
const sellerSearch = readFileSync("src/components/SellerLocationSearch.tsx", "utf8");
const sellerSearchRoute = readFileSync("src/app/api/seller/location/search/route.ts", "utf8");

test("seller workshop search does not use the confidential-address autocomplete path", () => {
  assert.doesNotMatch(locationPicker, /AddressAutocomplete/u);
  assert.match(locationPicker, /SellerLocationSearch/u);
  assert.match(sellerSearch, /<form onSubmit=\{search\}/u);
  assert.doesNotMatch(sellerSearch, /useEffect/u);
});

test("metro assignment does not send the caller's exact coordinates to Nominatim", () => {
  assert.doesNotMatch(reverseGeocode, /nominatim\.openstreetmap\.org\/reverse/u);
  assert.doesNotMatch(reverseGeocode, /lat: String\(lat\)/u);
  assert.doesNotMatch(reverseGeocode, /lon: String\(lng\)/u);
  assert.doesNotMatch(metroMapper, /reverseGeocode/u);
  assert.match(metroMapper, /if \(!publicLocality\) return \{ metroId: null, cityMetroId: null \}/u);
});

test("seller location provider accepts only a broad US locality or ZIP", () => {
  assert.equal(normalizeSellerLocationSearchQuery("Austin, Texas"), "Austin, TX");
  assert.equal(normalizeSellerLocationSearchQuery(" Austin,  TX "), "Austin, TX");
  assert.equal(normalizeSellerLocationSearchQuery("78701"), "78701");
  assert.equal(normalizeSellerLocationSearchQuery("78701-1234"), "78701-1234");

  for (const confidentialOrFreeForm of [
    "123 Main Street, Austin, TX",
    "123 Main Street",
    "My private workshop",
    "30.2672, -97.7431",
    "Travis County, TX",
  ]) {
    assert.equal(
      normalizeSellerLocationSearchQuery(confidentialOrFreeForm),
      null,
      confidentialOrFreeForm,
    );
  }
});

test("seller location provider drops street-level results", () => {
  assert.equal(sellerLocationPlaceToResult({
    lat: "30.2672",
    lon: "-97.7431",
    address: { house_number: "123", road: "Main Street", city: "Austin", state: "Texas" },
  }), null);
  assert.deepEqual(sellerLocationPlaceToResult({
    lat: "30.2672",
    lon: "-97.7431",
    address: { city: "Austin", state: "Texas", postcode: "78701", country_code: "us" },
  }), {
    label: "Austin, TX 78701",
    city: "Austin",
    state: "TX",
    postalCode: "78701",
    lat: 30.2672,
    lng: -97.7431,
  });
});

test("authenticated search validates before it constructs the Nominatim query", () => {
  assert.match(sellerSearchRoute, /const query = normalizeSellerLocationSearchQuery/u);
  assert.match(sellerSearchRoute, /if \(!query\)/u);
  assert.match(sellerSearchRoute, /q: `\$\{query\}, United States`/u);
  assert.ok(
    sellerSearchRoute.indexOf("normalizeSellerLocationSearchQuery")
      < sellerSearchRoute.indexOf("new URLSearchParams"),
  );
});
