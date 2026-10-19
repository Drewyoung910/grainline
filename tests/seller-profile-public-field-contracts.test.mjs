import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  SELLER_PROFILE_PUBLIC_LOCATION_SOURCE_FIELDS,
  SELLER_PROFILE_PUBLIC_PREDICATE_ONLY_FIELDS,
  SELLER_PROFILE_PUBLIC_PROFILE_FIELDS,
  SELLER_PROFILE_PURPOSE_BOUND_ONLY_FIELDS,
  SELLER_PROFILE_VISIBILITY_PREDICATES,
  verifySellerProfilePublicFieldContracts,
} from "../scripts/seller-profile-public-field-contracts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("all SellerProfile scalar fields have one fail-closed disclosure class", () => {
  assert.deepEqual(verifySellerProfilePublicFieldContracts(root), {
    scalarFields: 55,
    classCounts: {
      publicProfile: 38,
      publicPredicateOnly: 7,
      publicLocationSource: 4,
      purposeBoundOnly: 6,
    },
    genericPublicFields: 38,
    genericPublicExcludedFields: 17,
  });
  assert.equal(new Set([
    ...SELLER_PROFILE_PUBLIC_PROFILE_FIELDS,
    ...SELLER_PROFILE_PUBLIC_PREDICATE_ONLY_FIELDS,
    ...SELLER_PROFILE_PUBLIC_LOCATION_SOURCE_FIELDS,
    ...SELLER_PROFILE_PURPOSE_BOUND_ONLY_FIELDS,
  ]).size, 55);
});

test("every public location is derived and exact output needs private versioned consent", () => {
  assert.deepEqual(SELLER_PROFILE_VISIBILITY_PREDICATES.DIRECTORY_LOCATION, {
    visibility: "ACTIVE",
    publicMapOptIn: true,
    coordinatesPresentAndValid: true,
    radiusMeters: "NULL_OR_ZERO",
    defaultDerivation: "COARSE_PUBLIC_GRID",
    exactDerivation: "VERSIONED_PRIVATE_EXPLICIT_CONSENT",
    result: ["publicLat", "publicLng", "approximate"],
  });
  assert.deepEqual(SELLER_PROFILE_VISIBILITY_PREDICATES.PROFILE_LOCATION, {
    visibility: "CALLER_RESOURCE_VISIBILITY",
    publicResult: "APPROXIMATE_UNLESS_VERSIONED_PRIVATE_EXPLICIT_CONSENT",
    positiveRadiusDerivation: "RADIUS_SIZED_GRID",
    nullOrZeroRadiusDerivation: "COARSE_PUBLIC_GRID",
    exactResult: "PUBLIC_ONLY_WITH_CURRENT_PRIVATE_CONSENT",
    result: ["publicLat", "publicLng", "approximate"],
  });
  for (const field of ["userId", "lat", "lng", "radiusMeters", "publicMapOptIn", "chargesEnabled"]) {
    assert.equal(SELLER_PROFILE_PUBLIC_PROFILE_FIELDS.includes(field), false);
  }
});
