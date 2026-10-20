import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSellerLocationInput,
  sellerLocationPoint,
  sellerShopSettingsDatabaseErrorMessage,
  validateSellerShippingInput,
} from "../src/lib/sellerShopSettingsInput.ts";

const baseLocation = {
  lat: "30.2672",
  lng: "-97.7431",
  radiusMeters: "1609",
  publicMapOptIn: false,
  publicMapExactConsent: false,
  publicMapExactConsentVersion: "",
  publicMapExactConsentLat: "",
  publicMapExactConsentLng: "",
};

test("a seller with no saved pin does not acquire the map display center", () => {
  assert.equal(sellerLocationPoint(null, null), null);
  assert.equal(sellerLocationPoint(undefined, undefined), null);
  assert.equal(sellerLocationPoint(91, -97), null);
  assert.deepEqual(sellerLocationPoint(30.2672, -97.7431), {
    lat: 30.2672,
    lng: -97.7431,
  });

  assert.deepEqual(parseSellerLocationInput({
    ...baseLocation,
    lat: "",
    lng: "",
    radiusMeters: "",
  }), {
    ok: true,
    value: {
      lat: null,
      lng: null,
      radiusMeters: null,
      publicMapOptIn: false,
      publicMapExactConsent: false,
      publicMapExactConsentVersion: null,
      publicMapExactConsentLat: null,
      publicMapExactConsentLng: null,
    },
  });
});

test("seller location input rejects malformed, incomplete, and out-of-range values", () => {
  for (const input of [
    { ...baseLocation, lat: "30.2junk" },
    { ...baseLocation, lng: "" },
    { ...baseLocation, lat: "91" },
    { ...baseLocation, lng: "-181" },
    { ...baseLocation, radiusMeters: "1.5" },
    { ...baseLocation, radiusMeters: "8048" },
  ]) {
    const result = parseSellerLocationInput(input);
    assert.equal(result.ok, false, JSON.stringify(input));
  }
});

test("public map and exact-pin consent remain bound to the submitted point", () => {
  assert.deepEqual(parseSellerLocationInput({
    ...baseLocation,
    publicMapOptIn: true,
  }), {
    ok: true,
    value: {
      lat: 30.2672,
      lng: -97.7431,
      radiusMeters: 0,
      publicMapOptIn: true,
      publicMapExactConsent: false,
      publicMapExactConsentVersion: null,
      publicMapExactConsentLat: null,
      publicMapExactConsentLng: null,
    },
  });

  assert.equal(parseSellerLocationInput({
    ...baseLocation,
    publicMapOptIn: true,
    publicMapExactConsent: true,
    publicMapExactConsentVersion: "1",
    publicMapExactConsentLat: "30.2672",
    publicMapExactConsentLng: "-97.7431",
  }).ok, true);

  for (const input of [
    {
      ...baseLocation,
      publicMapExactConsent: true,
      publicMapExactConsentVersion: "1",
      publicMapExactConsentLat: "30.2672",
      publicMapExactConsentLng: "-97.7431",
    },
    {
      ...baseLocation,
      publicMapOptIn: true,
      publicMapExactConsent: true,
      publicMapExactConsentVersion: "1",
      publicMapExactConsentLat: "31",
      publicMapExactConsentLng: "-97.7431",
    },
  ]) {
    assert.equal(parseSellerLocationInput(input).ok, false, JSON.stringify(input));
  }
});

test("seller shipping input mirrors the database country and carrier bounds", () => {
  assert.deepEqual(validateSellerShippingInput("us", [" UPS ", "", "USPS"]), {
    ok: true,
    value: { shipFromCountry: "US", preferredCarriers: ["UPS", "USPS"] },
  });
  assert.equal(validateSellerShippingInput("United States", []).ok, false);
  assert.equal(validateSellerShippingInput("1A", []).ok, false);
  assert.equal(validateSellerShippingInput(new Blob(["US"]), []).ok, false);
  assert.equal(validateSellerShippingInput("US", Array.from({ length: 17 }, (_, i) => `c${i}`)).ok, false);
  assert.equal(validateSellerShippingInput("US", ["x".repeat(33)]).ok, false);
  assert.equal(validateSellerShippingInput("US", [new Blob(["UPS"])]).ok, false);
});

test("expected database denials return form errors while unknown failures remain loud", () => {
  for (const sqlState of ["22023", "23514", "40001", "42501"]) {
    assert.equal(typeof sellerShopSettingsDatabaseErrorMessage(sqlState), "string");
  }
  assert.equal(sellerShopSettingsDatabaseErrorMessage("XX000"), null);
  assert.equal(sellerShopSettingsDatabaseErrorMessage(null), null);
});
