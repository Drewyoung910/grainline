import assert from "node:assert/strict";
import test from "node:test";

import {
  evaluateSellerListingShippingReadiness,
  SELLER_SHIPPING_SETUP_REQUIRED_MESSAGE,
} from "../src/lib/sellerShippingReadiness.ts";

const baseSeller = Object.freeze({
  shippingFlatRateCents: null,
  allowLocalPickup: false,
  shipFromLine1: null,
  shipFromCity: null,
  shipFromState: null,
  shipFromPostal: null,
  shipFromCountry: "US",
  defaultPkgWeightGrams: null,
  defaultPkgLengthCm: null,
  defaultPkgWidthCm: null,
  defaultPkgHeightCm: null,
});

const listingPackage = Object.freeze({
  packagedWeightGrams: 1_000,
  packagedLengthCm: 30,
  packagedWidthCm: 20,
  packagedHeightCm: 10,
});

test("C-264 refuses a listing when the maker has no usable fulfillment method", () => {
  const result = evaluateSellerListingShippingReadiness(baseSeller, listingPackage);
  assert.deepEqual(result, {
    ready: false,
    hasFlatRate: false,
    allowsLocalPickup: false,
    hasCompleteShipFrom: false,
    hasCompletePackage: true,
  });
  assert.match(SELLER_SHIPPING_SETUP_REQUIRED_MESSAGE, /maker.*shipping setup/i);
});

test("C-264 accepts flat-rate and pickup fulfillment without calculated-shipping inputs", () => {
  assert.equal(evaluateSellerListingShippingReadiness({
    ...baseSeller,
    shippingFlatRateCents: 0,
  }, null).ready, true);
  assert.equal(evaluateSellerListingShippingReadiness({
    ...baseSeller,
    allowLocalPickup: true,
  }, null).ready, true);
});

test("C-264 calculated shipping requires both a complete origin and an effective package", () => {
  const sellerWithOrigin = {
    ...baseSeller,
    shipFromLine1: "100 Workshop Way",
    shipFromCity: "Austin",
    shipFromState: "TX",
    shipFromPostal: "78701",
  };
  assert.equal(
    evaluateSellerListingShippingReadiness(sellerWithOrigin, null).ready,
    false,
  );
  assert.equal(
    evaluateSellerListingShippingReadiness(sellerWithOrigin, listingPackage).ready,
    true,
  );
  assert.equal(
    evaluateSellerListingShippingReadiness({
      ...sellerWithOrigin,
      defaultPkgWeightGrams: 1_000,
      defaultPkgLengthCm: 30,
      defaultPkgWidthCm: 20,
      defaultPkgHeightCm: 10,
    }, null).ready,
    true,
  );
});

test("C-264 does not treat partial or zero package measurements as shippable", () => {
  const sellerWithOrigin = {
    ...baseSeller,
    shipFromLine1: "100 Workshop Way",
    shipFromCity: "Austin",
    shipFromState: "TX",
    shipFromPostal: "78701",
  };
  assert.equal(evaluateSellerListingShippingReadiness(sellerWithOrigin, {
    ...listingPackage,
    packagedHeightCm: null,
  }).ready, false);
  assert.equal(evaluateSellerListingShippingReadiness(sellerWithOrigin, {
    ...listingPackage,
    packagedWeightGrams: 0,
  }).ready, false);
});
