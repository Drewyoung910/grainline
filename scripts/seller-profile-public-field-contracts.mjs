import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Phase 0 design contract. These sets describe the maximum disclosure class
// for every scalar SellerProfile column. Future views/functions can return a
// narrower subset, but must never widen one of these classes implicitly.
export const SELLER_PROFILE_PUBLIC_PROFILE_FIELDS = Object.freeze([
  "id",
  "ownerImageUrl",
  "displayName",
  "bio",
  "city",
  "state",
  "createdAt",
  "updatedAt",
  "allowLocalPickup",
  "tagline",
  "bannerImageUrl",
  "avatarImageUrl",
  "workshopImageUrl",
  "storyTitle",
  "storyBody",
  "instagramUrl",
  "facebookUrl",
  "pinterestUrl",
  "tiktokUrl",
  "websiteUrl",
  "yearsInBusiness",
  "acceptsCustomOrders",
  "acceptingNewOrders",
  "offersGiftWrapping",
  "giftWrappingPriceCents",
  "returnPolicy",
  "customOrderPolicy",
  "shippingPolicy",
  "featuredListingIds",
  "galleryImageUrls",
  "galleryAltTexts",
  "isVerifiedMaker",
  "guildLevel",
  "vacationMode",
  "vacationReturnDate",
  "vacationMessage",
  "isFoundingMaker",
  "foundingMakerNumber",
]);

// Public authorities may evaluate these columns, but generic public results
// must not return them. This keeps provider/account state, normalized search
// keys, spotlight timing, and internal geography keys out of presentation
// rows while preserving existing filters and ordering.
export const SELLER_PROFILE_PUBLIC_PREDICATE_ONLY_FIELDS = Object.freeze([
  "ownerAccountActive",
  "displayNameNormalized",
  "chargesEnabled",
  "stripeAccountSupported",
  "featuredUntil",
  "metroId",
  "cityMetroId",
]);

// These raw values are inputs to a database-boundary location operation. A
// public caller receives only publicLat/publicLng/approximate after the
// relevant location rule has run; it never receives these four source fields
// through the general public-profile projection.
export const SELLER_PROFILE_PUBLIC_LOCATION_SOURCE_FIELDS = Object.freeze([
  "lat",
  "lng",
  "radiusMeters",
  "publicMapOptIn",
]);

// These columns are available only through an owner, participant, staff,
// service, or transaction-specific operation. Some operations may publish a
// derived result (for example a shipping quote), but do not expose the source
// column as generic profile data.
export const SELLER_PROFILE_PURPOSE_BOUND_ONLY_FIELDS = Object.freeze([
  "userId",
  "shippingFlatRateCents",
  "freeShippingOverCents",
  "customOrderTurnaroundDays",
  "verifiedAt",
  "foundingMakerAt",
]);

export const SELLER_PROFILE_VISIBILITY_PREDICATES = Object.freeze({
  VISIBLE: Object.freeze({
    ownerAccountActive: true,
    chargesEnabled: true,
    stripeAccountSupported: true,
  }),
  ACTIVE: Object.freeze({
    ownerAccountActive: true,
    chargesEnabled: true,
    stripeAccountSupported: true,
    vacationMode: false,
  }),
  DIRECTORY_LOCATION: Object.freeze({
    visibility: "ACTIVE",
    publicMapOptIn: true,
    coordinatesPresentAndValid: true,
    radiusMeters: "NULL_OR_ZERO",
    defaultDerivation: "COARSE_PUBLIC_GRID",
    exactDerivation: "VERSIONED_PRIVATE_EXPLICIT_CONSENT",
    result: Object.freeze(["publicLat", "publicLng", "approximate"]),
  }),
  PROFILE_LOCATION: Object.freeze({
    visibility: "CALLER_RESOURCE_VISIBILITY",
    publicResult: "APPROXIMATE_UNLESS_VERSIONED_PRIVATE_EXPLICIT_CONSENT",
    positiveRadiusDerivation: "RADIUS_SIZED_GRID",
    nullOrZeroRadiusDerivation: "COARSE_PUBLIC_GRID",
    exactResult: "PUBLIC_ONLY_WITH_CURRENT_PRIVATE_CONSENT",
    result: Object.freeze(["publicLat", "publicLng", "approximate"]),
  }),
});

const SCALAR_TYPES = new Set(["String", "Boolean", "Float", "Int", "DateTime", "GuildLevel"]);

function sellerProfileScalarFields(schema) {
  const body = /model SellerProfile \{([\s\S]*?)\n\}/u.exec(schema)?.[1];
  if (!body) throw new Error("SellerProfile model is missing from prisma/schema.prisma");
  const fields = [];
  for (const line of body.split("\n")) {
    const match = /^\s{2}(\w+)\s+([^\s]+)/u.exec(line);
    if (!match) continue;
    const baseType = match[2].replace(/[?\[\]]/gu, "");
    if (SCALAR_TYPES.has(baseType)) fields.push(match[1]);
  }
  return fields.sort();
}

function duplicates(values) {
  return [...new Set(values.filter((value, index) => values.indexOf(value) !== index))].sort();
}

export function verifySellerProfilePublicFieldContracts(root) {
  const schemaFields = sellerProfileScalarFields(
    fs.readFileSync(path.join(root, "prisma/schema.prisma"), "utf8"),
  );
  const groups = {
    publicProfile: SELLER_PROFILE_PUBLIC_PROFILE_FIELDS,
    publicPredicateOnly: SELLER_PROFILE_PUBLIC_PREDICATE_ONLY_FIELDS,
    publicLocationSource: SELLER_PROFILE_PUBLIC_LOCATION_SOURCE_FIELDS,
    purposeBoundOnly: SELLER_PROFILE_PURPOSE_BOUND_ONLY_FIELDS,
  };
  const classifiedFields = Object.values(groups).flat();
  const repeated = duplicates(classifiedFields);
  if (repeated.length) {
    throw new Error(`SellerProfile fields have multiple maximum-disclosure classes: ${repeated.join(", ")}`);
  }

  const schemaSet = new Set(schemaFields);
  const classifiedSet = new Set(classifiedFields);
  const missing = schemaFields.filter((field) => !classifiedSet.has(field));
  const stale = [...classifiedSet].filter((field) => !schemaSet.has(field)).sort();
  if (missing.length || stale.length) {
    throw new Error(
      `SellerProfile scalar-field contract drifted: missing=${missing.join(",") || "none"}; `
      + `stale=${stale.join(",") || "none"}`,
    );
  }

  const publicProfile = new Set(SELLER_PROFILE_PUBLIC_PROFILE_FIELDS);
  const forbiddenGenericPublicFields = [
    ...SELLER_PROFILE_PUBLIC_PREDICATE_ONLY_FIELDS,
    ...SELLER_PROFILE_PUBLIC_LOCATION_SOURCE_FIELDS,
    ...SELLER_PROFILE_PURPOSE_BOUND_ONLY_FIELDS,
  ];
  const publicLeaks = forbiddenGenericPublicFields.filter((field) => publicProfile.has(field));
  if (publicLeaks.length) {
    throw new Error(`Generic SellerProfile projection exposes restricted fields: ${publicLeaks.join(", ")}`);
  }

  const directory = SELLER_PROFILE_VISIBILITY_PREDICATES.DIRECTORY_LOCATION;
  if (directory.visibility !== "ACTIVE"
      || directory.publicMapOptIn !== true
      || directory.coordinatesPresentAndValid !== true
      || directory.radiusMeters !== "NULL_OR_ZERO"
      || directory.defaultDerivation !== "COARSE_PUBLIC_GRID"
      || directory.exactDerivation !== "VERSIONED_PRIVATE_EXPLICIT_CONSENT"
      || directory.result.join(",") !== "publicLat,publicLng,approximate") {
    throw new Error("SellerProfile directory-location predicate drifted");
  }
  const derived = SELLER_PROFILE_VISIBILITY_PREDICATES.PROFILE_LOCATION;
  if (derived.publicResult !== "APPROXIMATE_UNLESS_VERSIONED_PRIVATE_EXPLICIT_CONSENT"
      || derived.positiveRadiusDerivation !== "RADIUS_SIZED_GRID"
      || derived.nullOrZeroRadiusDerivation !== "COARSE_PUBLIC_GRID"
      || derived.exactResult !== "PUBLIC_ONLY_WITH_CURRENT_PRIVATE_CONSENT"
      || derived.result.join(",") !== "publicLat,publicLng,approximate") {
    throw new Error("SellerProfile derived public-location result drifted");
  }

  return {
    scalarFields: schemaFields.length,
    classCounts: Object.fromEntries(
      Object.entries(groups).map(([name, fields]) => [name, fields.length]),
    ),
    genericPublicFields: SELLER_PROFILE_PUBLIC_PROFILE_FIELDS.length,
    genericPublicExcludedFields: forbiddenGenericPublicFields.length,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  process.stdout.write(`${JSON.stringify(verifySellerProfilePublicFieldContracts(root), null, 2)}\n`);
}
