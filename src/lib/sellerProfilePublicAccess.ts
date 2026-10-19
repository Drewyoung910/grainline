import { Prisma } from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { isSupportedLocationPoint } from "@/lib/locationPrivacy";

export type SellerPublicMapPoint = Readonly<{
  id: string;
  displayName: string;
  city: string | null;
  state: string | null;
  publicLat: number;
  publicLng: number;
}>;

export type SellerPublicLocation = Readonly<{
  publicLat: number;
  publicLng: number;
  displayRadiusMeters: number | null;
  structuredGeoEligible: boolean;
  approximate: boolean;
}>;

export type SellerPublicNameSuggestion = Readonly<{
  id: string;
  displayName: string;
}>;

export type SellerPublicSitemapKind = "SELLERS" | "CUSTOMER_PHOTOS";

export type SellerPublicSitemapCounts = Readonly<{
  sellerCount: number;
  customerPhotoSellerCount: number;
}>;

export type SellerPublicMarketplaceCounts = Readonly<{
  activeSellerCount: number;
  foundingMakerCount: number;
}>;

export type SellerPublicSimilarMaker = Readonly<{
  id: string;
  displayName: string;
  tagline: string | null;
  city: string | null;
  state: string | null;
  guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
  avatarImageUrl: string | null;
  bannerImageUrl: string | null;
  ownerImageUrl: string | null;
  coverImageUrl: string | null;
  scopeKind: "METRO" | "STATE";
}>;

export type SellerPublicFeaturedMaker = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  bio: string | null;
  storyBody: string | null;
  yearsInBusiness: number | null;
  createdAt: Date;
  city: string | null;
  state: string | null;
  tagline: string | null;
  bannerImageUrl: string | null;
  avatarImageUrl: string | null;
  workshopImageUrl: string | null;
  featuredListingIds: readonly string[];
  guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
  isFoundingMaker: boolean;
  foundingMakerNumber: number | null;
  ownerImageUrl: string | null;
}>;

export type SellerPublicMapCard = Readonly<{
  id: string;
  displayName: string;
  tagline: string | null;
  city: string | null;
  state: string | null;
  guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
  isFoundingMaker: boolean;
  foundingMakerNumber: number | null;
  avatarImageUrl: string | null;
  bannerImageUrl: string | null;
  ownerImageUrl: string | null;
  coverImageUrl: string | null;
}>;

export type SellerPublicMetroMaker = Readonly<{
  id: string;
  displayName: string;
  tagline: string | null;
  city: string | null;
  state: string | null;
  avatarImageUrl: string | null;
  bannerImageUrl: string | null;
  guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
  ownerImageUrl: string | null;
  coverImageUrl: string | null;
  activeListingCount: number;
}>;

export type SellerPublicNearbyMetro = Readonly<{
  id: string;
  slug: string;
  name: string;
}>;

export type SellerPublicFooterMetro = Readonly<{
  slug: string;
  name: string;
  state: string;
}>;

export type SellerPublicViewTarget = Readonly<{
  ownerUserId: string;
}>;

export type SellerPublicProfileFaq = Readonly<{
  id: string;
  question: string;
  answer: string;
}>;

export type SellerPublicProfileMetro = Readonly<{
  slug: string;
  name: string;
  state: string;
}>;

export type SellerPublicProfile = Readonly<{
  id: string;
  displayName: string;
  bio: string | null;
  city: string | null;
  state: string | null;
  createdAt: Date;
  allowLocalPickup: boolean;
  tagline: string | null;
  bannerImageUrl: string | null;
  avatarImageUrl: string | null;
  workshopImageUrl: string | null;
  storyTitle: string | null;
  storyBody: string | null;
  instagramUrl: string | null;
  facebookUrl: string | null;
  pinterestUrl: string | null;
  tiktokUrl: string | null;
  websiteUrl: string | null;
  yearsInBusiness: number | null;
  acceptsCustomOrders: boolean;
  acceptingNewOrders: boolean;
  returnPolicy: string | null;
  customOrderPolicy: string | null;
  shippingPolicy: string | null;
  featuredListingIds: readonly string[];
  galleryImageUrls: readonly string[];
  galleryAltTexts: readonly string[];
  guildLevel: "NONE" | "GUILD_MEMBER" | "GUILD_MASTER";
  vacationMode: boolean;
  vacationReturnDate: Date | null;
  vacationMessage: string | null;
  isFoundingMaker: boolean;
  foundingMakerNumber: number | null;
  ownerImageUrl: string | null;
  viewerIsOwner: boolean;
  faqs: readonly SellerPublicProfileFaq[];
  metro: SellerPublicProfileMetro | null;
  cityMetro: SellerPublicProfileMetro | null;
}>;

export type SellerPublicBlogAuthor = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  tagline: string | null;
  avatarImageUrl: string | null;
  bannerImageUrl: string | null;
  ownerImageUrl: string | null;
}>;

export type SellerPublicCustomerPhotoHeader = Readonly<{
  id: string;
  userId: string;
  displayName: string;
  publicPhotosEligible: boolean;
}>;

export type SellerPublicSitemapRow = Readonly<{
  id: string;
  displayName: string;
  updatedAt: Date;
}>;

type SellerPublicMapPointRow = {
  id: unknown;
  displayName: unknown;
  city: unknown;
  state: unknown;
  publicLat: unknown;
  publicLng: unknown;
};

type SellerPublicLocationRow = {
  publicLat: unknown;
  publicLng: unknown;
  displayRadiusMeters: unknown;
  structuredGeoEligible: unknown;
};

type SellerPublicBrowseNearbyRow = {
  sellerProfileId: unknown;
};

type SellerPublicNameSuggestionRow = {
  id: unknown;
  displayName: unknown;
};

type SellerPublicSitemapCountsRow = {
  sellerCount: unknown;
  customerPhotoSellerCount: unknown;
};

type SellerPublicMarketplaceCountsRow = {
  activeSellerCount: unknown;
  foundingMakerCount: unknown;
};

type SellerPublicCountRow = {
  value: unknown;
};

type SellerPublicSimilarMakerRow = {
  id: unknown;
  displayName: unknown;
  tagline: unknown;
  city: unknown;
  state: unknown;
  guildLevel: unknown;
  avatarImageUrl: unknown;
  bannerImageUrl: unknown;
  ownerImageUrl: unknown;
  coverImageUrl: unknown;
  scopeKind: unknown;
};

type SellerPublicFeaturedMakerRow = {
  id: unknown;
  userId: unknown;
  displayName: unknown;
  bio: unknown;
  storyBody: unknown;
  yearsInBusiness: unknown;
  createdAt: unknown;
  city: unknown;
  state: unknown;
  tagline: unknown;
  bannerImageUrl: unknown;
  avatarImageUrl: unknown;
  workshopImageUrl: unknown;
  featuredListingIds: unknown;
  guildLevel: unknown;
  isFoundingMaker: unknown;
  foundingMakerNumber: unknown;
  ownerImageUrl: unknown;
};

type SellerPublicMapCardRow = {
  id: unknown;
  displayName: unknown;
  tagline: unknown;
  city: unknown;
  state: unknown;
  guildLevel: unknown;
  isFoundingMaker: unknown;
  foundingMakerNumber: unknown;
  avatarImageUrl: unknown;
  bannerImageUrl: unknown;
  ownerImageUrl: unknown;
  coverImageUrl: unknown;
};

type SellerPublicMetroStaticSlugRow = {
  slug: unknown;
};

type SellerPublicMetroMakerRow = {
  id: unknown;
  displayName: unknown;
  tagline: unknown;
  city: unknown;
  state: unknown;
  avatarImageUrl: unknown;
  bannerImageUrl: unknown;
  guildLevel: unknown;
  ownerImageUrl: unknown;
  coverImageUrl: unknown;
  activeListingCount: unknown;
};

type SellerPublicNearbyMetroRow = {
  id: unknown;
  slug: unknown;
  name: unknown;
};

type SellerPublicFooterMetroRow = {
  slug: unknown;
  name: unknown;
  state: unknown;
};

type SellerPublicViewTargetRow = {
  ownerUserId: unknown;
};

type SellerPublicProfileRow = {
  id: unknown;
  displayName: unknown;
  bio: unknown;
  city: unknown;
  state: unknown;
  createdAt: unknown;
  allowLocalPickup: unknown;
  tagline: unknown;
  bannerImageUrl: unknown;
  avatarImageUrl: unknown;
  workshopImageUrl: unknown;
  storyTitle: unknown;
  storyBody: unknown;
  instagramUrl: unknown;
  facebookUrl: unknown;
  pinterestUrl: unknown;
  tiktokUrl: unknown;
  websiteUrl: unknown;
  yearsInBusiness: unknown;
  acceptsCustomOrders: unknown;
  acceptingNewOrders: unknown;
  returnPolicy: unknown;
  customOrderPolicy: unknown;
  shippingPolicy: unknown;
  featuredListingIds: unknown;
  galleryImageUrls: unknown;
  galleryAltTexts: unknown;
  guildLevel: unknown;
  vacationMode: unknown;
  vacationReturnDate: unknown;
  vacationMessage: unknown;
  isFoundingMaker: unknown;
  foundingMakerNumber: unknown;
  ownerImageUrl: unknown;
  viewerIsOwner: unknown;
  faqs: unknown;
  metro: unknown;
  cityMetro: unknown;
};

type SellerPublicBlogAuthorRow = {
  id: unknown;
  userId: unknown;
  displayName: unknown;
  tagline: unknown;
  avatarImageUrl: unknown;
  bannerImageUrl: unknown;
  ownerImageUrl: unknown;
};

type SellerPublicCustomerPhotoHeaderRow = {
  id: unknown;
  userId: unknown;
  displayName: unknown;
  publicPhotosEligible: unknown;
};

type SellerPublicReportTargetRow = {
  value: unknown;
};

type SellerPublicSitemapRowResult = {
  id: unknown;
  displayName: unknown;
  updatedAt: unknown;
};

type SellerPublicAccessClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function parseNullableDate(value: unknown, label: string) {
  if (value === null) return null;
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Seller public authority returned an invalid ${label}`);
  }
  return value;
}

function parseSellerPublicProfileMetro(
  value: unknown,
  label: string,
): SellerPublicProfileMetro | null {
  if (value === null) return null;
  if (
    typeof value !== "object"
    || value === null
    || typeof (value as Record<string, unknown>).slug !== "string"
    || !(value as Record<string, unknown>).slug
    || typeof (value as Record<string, unknown>).name !== "string"
    || !(value as Record<string, unknown>).name
    || typeof (value as Record<string, unknown>).state !== "string"
    || !(value as Record<string, unknown>).state
  ) {
    throw new Error(`Seller public authority returned an invalid ${label}`);
  }
  const metro = value as Record<string, string>;
  return Object.freeze({ slug: metro.slug, name: metro.name, state: metro.state });
}

function parseSellerPublicProfileFaqs(value: unknown) {
  if (!Array.isArray(value)) {
    throw new Error("Seller public authority returned invalid FAQs");
  }
  return Object.freeze(value.map((entry) => {
    if (
      typeof entry !== "object"
      || entry === null
      || typeof (entry as Record<string, unknown>).id !== "string"
      || !(entry as Record<string, unknown>).id
      || typeof (entry as Record<string, unknown>).question !== "string"
      || typeof (entry as Record<string, unknown>).answer !== "string"
    ) {
      throw new Error("Seller public authority returned an invalid FAQ");
    }
    const faq = entry as Record<string, string>;
    return Object.freeze({ id: faq.id, question: faq.question, answer: faq.answer });
  }));
}

function parseSellerPublicProfile(row: SellerPublicProfileRow): SellerPublicProfile {
  const stringArrays = [
    [row.featuredListingIds, "featured listing ids"],
    [row.galleryImageUrls, "gallery image URLs"],
    [row.galleryAltTexts, "gallery alt texts"],
  ] as const;
  for (const [value, label] of stringArrays) {
    if (!Array.isArray(value) || !value.every((entry) => typeof entry === "string")) {
      throw new Error(`Seller public authority returned invalid ${label}`);
    }
  }
  if (
    typeof row.id !== "string"
    || !row.id
    || typeof row.displayName !== "string"
    || !row.displayName
    || !nullableString(row.bio)
    || !nullableString(row.city)
    || !nullableString(row.state)
    || !(row.createdAt instanceof Date)
    || Number.isNaN(row.createdAt.getTime())
    || typeof row.allowLocalPickup !== "boolean"
    || !nullableString(row.tagline)
    || !nullableString(row.bannerImageUrl)
    || !nullableString(row.avatarImageUrl)
    || !nullableString(row.workshopImageUrl)
    || !nullableString(row.storyTitle)
    || !nullableString(row.storyBody)
    || !nullableString(row.instagramUrl)
    || !nullableString(row.facebookUrl)
    || !nullableString(row.pinterestUrl)
    || !nullableString(row.tiktokUrl)
    || !nullableString(row.websiteUrl)
    || typeof row.acceptsCustomOrders !== "boolean"
    || typeof row.acceptingNewOrders !== "boolean"
    || !nullableString(row.returnPolicy)
    || !nullableString(row.customOrderPolicy)
    || !nullableString(row.shippingPolicy)
    || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
    || typeof row.vacationMode !== "boolean"
    || !nullableString(row.vacationMessage)
    || typeof row.isFoundingMaker !== "boolean"
    || !nullableString(row.ownerImageUrl)
    || typeof row.viewerIsOwner !== "boolean"
  ) {
    throw new Error("Seller public profile authority returned an invalid result");
  }
  return Object.freeze({
    id: row.id,
    displayName: row.displayName,
    bio: row.bio,
    city: row.city,
    state: row.state,
    createdAt: row.createdAt,
    allowLocalPickup: row.allowLocalPickup,
    tagline: row.tagline,
    bannerImageUrl: row.bannerImageUrl,
    avatarImageUrl: row.avatarImageUrl,
    workshopImageUrl: row.workshopImageUrl,
    storyTitle: row.storyTitle,
    storyBody: row.storyBody,
    instagramUrl: row.instagramUrl,
    facebookUrl: row.facebookUrl,
    pinterestUrl: row.pinterestUrl,
    tiktokUrl: row.tiktokUrl,
    websiteUrl: row.websiteUrl,
    yearsInBusiness: parseNullableSafeInteger(row.yearsInBusiness, "years in business"),
    acceptsCustomOrders: row.acceptsCustomOrders,
    acceptingNewOrders: row.acceptingNewOrders,
    returnPolicy: row.returnPolicy,
    customOrderPolicy: row.customOrderPolicy,
    shippingPolicy: row.shippingPolicy,
    featuredListingIds: Object.freeze([...(row.featuredListingIds as string[])]),
    galleryImageUrls: Object.freeze([...(row.galleryImageUrls as string[])]),
    galleryAltTexts: Object.freeze([...(row.galleryAltTexts as string[])]),
    guildLevel: row.guildLevel as SellerPublicProfile["guildLevel"],
    vacationMode: row.vacationMode,
    vacationReturnDate: parseNullableDate(row.vacationReturnDate, "vacation return date"),
    vacationMessage: row.vacationMessage,
    isFoundingMaker: row.isFoundingMaker,
    foundingMakerNumber: parseNullableSafeInteger(
      row.foundingMakerNumber,
      "founding maker number",
    ),
    ownerImageUrl: row.ownerImageUrl,
    viewerIsOwner: row.viewerIsOwner,
    faqs: parseSellerPublicProfileFaqs(row.faqs),
    metro: parseSellerPublicProfileMetro(row.metro, "metro"),
    cityMetro: parseSellerPublicProfileMetro(row.cityMetro, "city metro"),
  });
}

function parsePublicMapPoint(row: SellerPublicMapPointRow): SellerPublicMapPoint {
  const publicLat = Number(row.publicLat);
  const publicLng = Number(row.publicLng);
  if (
    typeof row.id !== "string"
    || typeof row.displayName !== "string"
    || !nullableString(row.city)
    || !nullableString(row.state)
    || !isSupportedLocationPoint(publicLat, publicLng)
  ) {
    throw new Error("Seller public map authority returned an invalid result");
  }
  return Object.freeze({
    id: row.id,
    displayName: row.displayName,
    city: row.city,
    state: row.state,
    publicLat,
    publicLng,
  });
}

async function readSellerPublicMapPoints(client: SellerPublicAccessClient, limit: number) {
  const rows = await client.$queryRaw<SellerPublicMapPointRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_map_points(${limit})
  `);
  return rows.map(parsePublicMapPoint);
}

async function readSellerPublicLocation(
  client: SellerPublicAccessClient,
  sellerProfileId: string,
  listingId: string | null,
) {
  const rows = await client.$queryRaw<SellerPublicLocationRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_location(
        ${sellerProfileId},
        ${listingId}
      )
  `);
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller public location authority returned multiple results");
  }
  const row = rows[0];
  const publicLat = Number(row.publicLat);
  const publicLng = Number(row.publicLng);
  const displayRadiusMeters = row.displayRadiusMeters == null
    ? null
    : Number(row.displayRadiusMeters);
  if (
    !isSupportedLocationPoint(publicLat, publicLng)
    || (displayRadiusMeters !== null
      && (!Number.isSafeInteger(displayRadiusMeters) || displayRadiusMeters <= 0))
    || typeof row.structuredGeoEligible !== "boolean"
  ) {
    throw new Error("Seller public location authority returned an invalid result");
  }
  return Object.freeze({
    publicLat,
    publicLng,
    displayRadiusMeters,
    structuredGeoEligible: row.structuredGeoEligible,
    approximate: !row.structuredGeoEligible,
  });
}

async function readSellerPublicBrowseNearbySellerIds(
  client: SellerPublicAccessClient,
  lat: number,
  lng: number,
  radiusMiles: number,
) {
  const rows = await client.$queryRaw<SellerPublicBrowseNearbyRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_browse_nearby(
        ${lat},
        ${lng},
        ${radiusMiles}
      )
  `);
  const sellerProfileIds = rows.map((row) => {
    if (typeof row.sellerProfileId !== "string" || !row.sellerProfileId) {
      throw new Error("Seller public browse authority returned an invalid result");
    }
    return row.sellerProfileId;
  });
  if (new Set(sellerProfileIds).size !== sellerProfileIds.length) {
    throw new Error("Seller public browse authority returned duplicate results");
  }
  return Object.freeze(sellerProfileIds);
}

async function readSellerPublicNameSuggestions(
  client: SellerPublicAccessClient,
  query: string,
  normalizedQuery: string,
  requirePublicListing: boolean,
  limit: number,
) {
  const rows = await client.$queryRaw<SellerPublicNameSuggestionRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_name_suggestions(
        ${query},
        ${normalizedQuery},
        ${requirePublicListing},
        ${limit}
      )
  `);
  const suggestions = rows.map((row) => {
    if (
      typeof row.id !== "string"
      || !row.id
      || typeof row.displayName !== "string"
      || !row.displayName
    ) {
      throw new Error("Seller public name authority returned an invalid result");
    }
    return Object.freeze({ id: row.id, displayName: row.displayName });
  });
  if (new Set(suggestions.map((row) => row.id)).size !== suggestions.length) {
    throw new Error("Seller public name authority returned duplicate results");
  }
  return Object.freeze(suggestions);
}

function parseSafeCount(value: unknown, label: string) {
  const count = Number(value);
  if (!Number.isSafeInteger(count) || count < 0) {
    throw new Error(`Seller public authority returned an invalid ${label}`);
  }
  return count;
}

function parseNullableSafeInteger(value: unknown, label: string) {
  if (value === null) return null;
  const integer = Number(value);
  if (!Number.isSafeInteger(integer)) {
    throw new Error(`Seller public authority returned an invalid ${label}`);
  }
  return integer;
}

async function readSellerPublicMarketplaceCounts(client: SellerPublicAccessClient) {
  const rows = await client.$queryRaw<SellerPublicMarketplaceCountsRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_marketplace_counts()
  `);
  if (rows.length !== 1) {
    throw new Error("Seller public marketplace count authority returned an invalid result");
  }
  return Object.freeze({
    activeSellerCount: parseSafeCount(rows[0].activeSellerCount, "active seller count"),
    foundingMakerCount: parseSafeCount(rows[0].foundingMakerCount, "founding maker count"),
  });
}

async function readSellerPublicMetroCount(
  client: SellerPublicAccessClient,
  metroId: string,
  isMajor: boolean,
  requirePublicListing: boolean,
) {
  const rows = await client.$queryRaw<SellerPublicCountRow[]>(Prisma.sql`
    SELECT public.grainline_seller_public_metro_count(
      ${metroId},
      ${isMajor},
      ${requirePublicListing}
    ) AS value
  `);
  if (rows.length !== 1) {
    throw new Error("Seller public metro count authority returned an invalid result");
  }
  return parseSafeCount(rows[0].value, "metro seller count");
}

async function readSellerPublicSimilarMakers(
  client: SellerPublicAccessClient,
  sourceListingId: string,
  limit: number,
) {
  const rows = await client.$queryRaw<SellerPublicSimilarMakerRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_similar_makers(
        ${sourceListingId},
        ${limit}
      )
  `);
  const makers = rows.map((row) => {
    if (
      typeof row.id !== "string"
      || !row.id
      || typeof row.displayName !== "string"
      || !row.displayName
      || !nullableString(row.tagline)
      || !nullableString(row.city)
      || !nullableString(row.state)
      || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
      || !nullableString(row.avatarImageUrl)
      || !nullableString(row.bannerImageUrl)
      || !nullableString(row.ownerImageUrl)
      || !nullableString(row.coverImageUrl)
      || !["METRO", "STATE"].includes(String(row.scopeKind))
    ) {
      throw new Error("Seller public similar-maker authority returned an invalid result");
    }
    return Object.freeze({
      id: row.id,
      displayName: row.displayName,
      tagline: row.tagline,
      city: row.city,
      state: row.state,
      guildLevel: row.guildLevel as SellerPublicSimilarMaker["guildLevel"],
      avatarImageUrl: row.avatarImageUrl,
      bannerImageUrl: row.bannerImageUrl,
      ownerImageUrl: row.ownerImageUrl,
      coverImageUrl: row.coverImageUrl,
      scopeKind: row.scopeKind as SellerPublicSimilarMaker["scopeKind"],
    });
  });
  if (makers.length > limit || new Set(makers.map((maker) => maker.id)).size !== makers.length) {
    throw new Error("Seller public similar-maker authority returned invalid cardinality");
  }
  return Object.freeze(makers);
}

async function readSellerPublicFeaturedMakers(client: SellerPublicAccessClient) {
  const rows = await client.$queryRaw<SellerPublicFeaturedMakerRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_featured_makers()
  `);
  const makers = rows.map((row) => {
    if (
      typeof row.id !== "string"
      || !row.id
      || typeof row.userId !== "string"
      || !row.userId
      || typeof row.displayName !== "string"
      || !row.displayName
      || !nullableString(row.bio)
      || !nullableString(row.storyBody)
      || !(row.createdAt instanceof Date)
      || Number.isNaN(row.createdAt.getTime())
      || !nullableString(row.city)
      || !nullableString(row.state)
      || !nullableString(row.tagline)
      || !nullableString(row.bannerImageUrl)
      || !nullableString(row.avatarImageUrl)
      || !nullableString(row.workshopImageUrl)
      || !Array.isArray(row.featuredListingIds)
      || !row.featuredListingIds.every((id) => typeof id === "string" && id.length > 0)
      || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
      || typeof row.isFoundingMaker !== "boolean"
      || !nullableString(row.ownerImageUrl)
    ) {
      throw new Error("Seller public featured-maker authority returned an invalid result");
    }
    return Object.freeze({
      id: row.id,
      userId: row.userId,
      displayName: row.displayName,
      bio: row.bio,
      storyBody: row.storyBody,
      yearsInBusiness: parseNullableSafeInteger(row.yearsInBusiness, "years in business"),
      createdAt: row.createdAt,
      city: row.city,
      state: row.state,
      tagline: row.tagline,
      bannerImageUrl: row.bannerImageUrl,
      avatarImageUrl: row.avatarImageUrl,
      workshopImageUrl: row.workshopImageUrl,
      featuredListingIds: Object.freeze([...row.featuredListingIds]),
      guildLevel: row.guildLevel as SellerPublicFeaturedMaker["guildLevel"],
      isFoundingMaker: row.isFoundingMaker,
      foundingMakerNumber: parseNullableSafeInteger(
        row.foundingMakerNumber,
        "founding maker number",
      ),
      ownerImageUrl: row.ownerImageUrl,
    });
  });
  if (makers.length > 2 || new Set(makers.map((maker) => maker.id)).size !== makers.length) {
    throw new Error("Seller public featured-maker authority returned invalid cardinality");
  }
  return Object.freeze(makers);
}

async function readSellerPublicMapCard(
  client: SellerPublicAccessClient,
  sellerProfileId: string,
) {
  const rows = await client.$queryRaw<SellerPublicMapCardRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_map_card(${sellerProfileId})
  `);
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller public map-card authority returned multiple results");
  }
  const row = rows[0];
  if (
    typeof row.id !== "string"
    || !row.id
    || typeof row.displayName !== "string"
    || !row.displayName
    || !nullableString(row.tagline)
    || !nullableString(row.city)
    || !nullableString(row.state)
    || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
    || typeof row.isFoundingMaker !== "boolean"
    || !nullableString(row.avatarImageUrl)
    || !nullableString(row.bannerImageUrl)
    || !nullableString(row.ownerImageUrl)
    || !nullableString(row.coverImageUrl)
  ) {
    throw new Error("Seller public map-card authority returned an invalid result");
  }
  return Object.freeze({
    id: row.id,
    displayName: row.displayName,
    tagline: row.tagline,
    city: row.city,
    state: row.state,
    guildLevel: row.guildLevel as SellerPublicMapCard["guildLevel"],
    isFoundingMaker: row.isFoundingMaker,
    foundingMakerNumber: parseNullableSafeInteger(
      row.foundingMakerNumber,
      "founding maker number",
    ),
    avatarImageUrl: row.avatarImageUrl,
    bannerImageUrl: row.bannerImageUrl,
    ownerImageUrl: row.ownerImageUrl,
    coverImageUrl: row.coverImageUrl,
  });
}

async function readSellerPublicMetroStaticSlugs(client: SellerPublicAccessClient) {
  const rows = await client.$queryRaw<SellerPublicMetroStaticSlugRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_metro_static_slugs()
  `);
  const slugs = rows.map((row) => {
    if (typeof row.slug !== "string" || !row.slug) {
      throw new Error("Seller public metro-static authority returned an invalid result");
    }
    return Object.freeze({ slug: row.slug });
  });
  if (new Set(slugs.map(({ slug }) => slug)).size !== slugs.length) {
    throw new Error("Seller public metro-static authority returned duplicate results");
  }
  return Object.freeze(slugs);
}

async function readSellerPublicMetroMakers(
  client: SellerPublicAccessClient,
  metroId: string,
  isMajor: boolean,
  limit: number,
) {
  const rows = await client.$queryRaw<SellerPublicMetroMakerRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_metro_makers(
        ${metroId},
        ${isMajor},
        ${limit}
      )
  `);
  const makers = rows.map((row) => {
    if (
      typeof row.id !== "string"
      || !row.id
      || typeof row.displayName !== "string"
      || !row.displayName
      || !nullableString(row.tagline)
      || !nullableString(row.city)
      || !nullableString(row.state)
      || !nullableString(row.avatarImageUrl)
      || !nullableString(row.bannerImageUrl)
      || !["NONE", "GUILD_MEMBER", "GUILD_MASTER"].includes(String(row.guildLevel))
      || !nullableString(row.ownerImageUrl)
      || !nullableString(row.coverImageUrl)
    ) {
      throw new Error("Seller public metro-maker authority returned an invalid result");
    }
    return Object.freeze({
      id: row.id,
      displayName: row.displayName,
      tagline: row.tagline,
      city: row.city,
      state: row.state,
      avatarImageUrl: row.avatarImageUrl,
      bannerImageUrl: row.bannerImageUrl,
      guildLevel: row.guildLevel as SellerPublicMetroMaker["guildLevel"],
      ownerImageUrl: row.ownerImageUrl,
      coverImageUrl: row.coverImageUrl,
      activeListingCount: parseSafeCount(row.activeListingCount, "active listing count"),
    });
  });
  if (makers.length > limit || new Set(makers.map(({ id }) => id)).size !== makers.length) {
    throw new Error("Seller public metro-maker authority returned invalid cardinality");
  }
  return Object.freeze(makers);
}

async function readSellerPublicNearbyMetros(
  client: SellerPublicAccessClient,
  metroId: string,
) {
  const rows = await client.$queryRaw<SellerPublicNearbyMetroRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_nearby_metros(${metroId})
  `);
  const metros = rows.map((row) => {
    if (
      typeof row.id !== "string"
      || !row.id
      || typeof row.slug !== "string"
      || !row.slug
      || typeof row.name !== "string"
      || !row.name
    ) {
      throw new Error("Seller public nearby-metro authority returned an invalid result");
    }
    return Object.freeze({ id: row.id, slug: row.slug, name: row.name });
  });
  if (new Set(metros.map(({ id }) => id)).size !== metros.length) {
    throw new Error("Seller public nearby-metro authority returned duplicate results");
  }
  return Object.freeze(metros);
}

async function readSellerPublicFooterMetros(client: SellerPublicAccessClient) {
  const rows = await client.$queryRaw<SellerPublicFooterMetroRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_footer_metros()
  `);
  const metros = rows.map((row) => {
    if (
      typeof row.slug !== "string"
      || !row.slug
      || typeof row.name !== "string"
      || !row.name
      || typeof row.state !== "string"
      || !row.state
    ) {
      throw new Error("Seller public footer-metro authority returned an invalid result");
    }
    return Object.freeze({ slug: row.slug, name: row.name, state: row.state });
  });
  if (metros.length > 10 || new Set(metros.map(({ slug }) => slug)).size !== metros.length) {
    throw new Error("Seller public footer-metro authority returned invalid cardinality");
  }
  return Object.freeze(metros);
}

async function readSellerPublicViewTarget(
  client: SellerPublicAccessClient,
  sellerProfileId: string,
) {
  const rows = await client.$queryRaw<SellerPublicViewTargetRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_view_target(${sellerProfileId})
  `);
  if (rows.length === 0) return null;
  if (
    rows.length !== 1
    || typeof rows[0].ownerUserId !== "string"
    || !rows[0].ownerUserId
  ) {
    throw new Error("Seller public view-target authority returned an invalid result");
  }
  return Object.freeze({ ownerUserId: rows[0].ownerUserId });
}

async function readSellerPublicProfile(
  client: SellerPublicAccessClient,
  sellerProfileId: string,
) {
  const rows = await client.$queryRaw<SellerPublicProfileRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_profile(${sellerProfileId})
  `);
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller public profile authority returned multiple results");
  }
  return parseSellerPublicProfile(rows[0]);
}

async function readSellerPublicBlogAuthor(
  client: SellerPublicAccessClient,
  sellerProfileId: string,
) {
  const rows = await client.$queryRaw<SellerPublicBlogAuthorRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_blog_author(${sellerProfileId})
  `);
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller public blog-author authority returned multiple results");
  }
  const row = rows[0];
  if (
    typeof row.id !== "string"
    || !row.id
    || typeof row.userId !== "string"
    || !row.userId
    || typeof row.displayName !== "string"
    || !row.displayName
    || !nullableString(row.tagline)
    || !nullableString(row.avatarImageUrl)
    || !nullableString(row.bannerImageUrl)
    || !nullableString(row.ownerImageUrl)
  ) {
    throw new Error("Seller public blog-author authority returned an invalid result");
  }
  return Object.freeze({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    tagline: row.tagline,
    avatarImageUrl: row.avatarImageUrl,
    bannerImageUrl: row.bannerImageUrl,
    ownerImageUrl: row.ownerImageUrl,
  });
}

async function readSellerPublicCustomerPhotoHeader(
  client: SellerPublicAccessClient,
  sellerProfileId: string,
) {
  const rows = await client.$queryRaw<SellerPublicCustomerPhotoHeaderRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_customer_photo_header(${sellerProfileId})
  `);
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new Error("Seller customer-photo authority returned multiple results");
  }
  const row = rows[0];
  if (
    typeof row.id !== "string"
    || !row.id
    || typeof row.userId !== "string"
    || !row.userId
    || typeof row.displayName !== "string"
    || !row.displayName
    || typeof row.publicPhotosEligible !== "boolean"
  ) {
    throw new Error("Seller customer-photo authority returned an invalid result");
  }
  return Object.freeze({
    id: row.id,
    userId: row.userId,
    displayName: row.displayName,
    publicPhotosEligible: row.publicPhotosEligible,
  });
}

async function readSellerPublicReportTarget(
  client: SellerPublicAccessClient,
  sellerProfileId: string,
  reportedUserId: string,
) {
  const rows = await client.$queryRaw<SellerPublicReportTargetRow[]>(Prisma.sql`
    SELECT public.grainline_seller_public_report_target(
      ${sellerProfileId},
      ${reportedUserId}
    ) AS value
  `);
  if (rows.length !== 1 || typeof rows[0].value !== "boolean") {
    throw new Error("Seller public report-target authority returned an invalid result");
  }
  return rows[0].value;
}

async function readSellerPublicSitemapCounts(client: SellerPublicAccessClient) {
  const rows = await client.$queryRaw<SellerPublicSitemapCountsRow[]>(Prisma.sql`
    SELECT * FROM public.grainline_seller_public_sitemap_counts()
  `);
  if (rows.length !== 1) {
    throw new Error("Seller public sitemap count authority returned an invalid result");
  }
  return Object.freeze({
    sellerCount: parseSafeCount(rows[0].sellerCount, "seller count"),
    customerPhotoSellerCount: parseSafeCount(
      rows[0].customerPhotoSellerCount,
      "customer-photo seller count",
    ),
  });
}

async function readSellerPublicSitemapPage(
  client: SellerPublicAccessClient,
  kind: SellerPublicSitemapKind,
  skip: number,
  take: number,
) {
  const rows = await client.$queryRaw<SellerPublicSitemapRowResult[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_sitemap_page(${kind}, ${skip}, ${take})
  `);
  return Object.freeze(rows.map((row) => {
    if (
      typeof row.id !== "string"
      || !row.id
      || typeof row.displayName !== "string"
      || !row.displayName
      || !(row.updatedAt instanceof Date)
      || Number.isNaN(row.updatedAt.getTime())
    ) {
      throw new Error("Seller public sitemap page authority returned an invalid result");
    }
    return Object.freeze({
      id: row.id,
      displayName: row.displayName,
      updatedAt: row.updatedAt,
    });
  }));
}

export async function sellerPublicMapPoints(
  viewerUserId: string | null,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 500) {
    throw new RangeError("Seller public map limit is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicMapPoints(client, limit));
  }
  return readSellerPublicMapPoints(prisma, limit);
}

export async function sellerPublicLocation(
  viewerUserId: string | null,
  sellerProfileId: string,
  listingId: string | null,
) {
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicLocation(client, sellerProfileId, listingId));
  }
  return readSellerPublicLocation(prisma, sellerProfileId, listingId);
}

export async function sellerPublicBrowseNearbySellerIds(
  viewerUserId: string | null,
  lat: number,
  lng: number,
  radiusMiles: number,
) {
  if (
    !Number.isFinite(lat)
    || lat < -90
    || lat > 90
    || !Number.isFinite(lng)
    || lng < -180
    || lng > 180
    || !Number.isFinite(radiusMiles)
    || radiusMiles < 1
    || radiusMiles > 500
  ) {
    throw new RangeError("Seller public browse location is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicBrowseNearbySellerIds(client, lat, lng, radiusMiles));
  }
  return readSellerPublicBrowseNearbySellerIds(prisma, lat, lng, radiusMiles);
}

export async function sellerPublicNameSuggestions(
  viewerUserId: string | null,
  query: string,
  normalizedQuery: string,
  requirePublicListing: boolean,
  limit: number,
) {
  if (
    query.length < 1
    || query.length > 200
    || normalizedQuery.length > 100
    || typeof requirePublicListing !== "boolean"
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 10
  ) {
    throw new RangeError("Seller public name suggestion input is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicNameSuggestions(
        client,
        query,
        normalizedQuery,
        requirePublicListing,
        limit,
      ));
  }
  return readSellerPublicNameSuggestions(
    prisma,
    query,
    normalizedQuery,
    requirePublicListing,
    limit,
  );
}

export async function sellerPublicSitemapCounts() {
  return readSellerPublicSitemapCounts(prisma);
}

export async function sellerPublicMarketplaceCounts() {
  return readSellerPublicMarketplaceCounts(prisma);
}

export async function sellerPublicMetroCount(
  viewerUserId: string | null,
  metroId: string,
  isMajor: boolean,
  requirePublicListing: boolean,
) {
  if (
    !/^[A-Za-z0-9._:-]{1,191}$/u.test(metroId)
    || typeof isMajor !== "boolean"
    || typeof requirePublicListing !== "boolean"
  ) {
    throw new RangeError("Seller public metro count input is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicMetroCount(client, metroId, isMajor, requirePublicListing));
  }
  return readSellerPublicMetroCount(prisma, metroId, isMajor, requirePublicListing);
}

export async function sellerPublicSimilarMakers(
  viewerUserId: string | null,
  sourceListingId: string,
  limit: number,
) {
  if (
    !/^[A-Za-z0-9._:-]{1,191}$/u.test(sourceListingId)
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 4
  ) {
    throw new RangeError("Seller public similar-maker input is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicSimilarMakers(client, sourceListingId, limit));
  }
  return readSellerPublicSimilarMakers(prisma, sourceListingId, limit);
}

export async function sellerPublicFeaturedMakers() {
  return readSellerPublicFeaturedMakers(prisma);
}

export async function sellerPublicMapCard(sellerProfileId: string) {
  if (sellerProfileId.length < 1 || sellerProfileId.length > 64) {
    throw new RangeError("Seller public map-card id is outside the supported range");
  }
  return readSellerPublicMapCard(prisma, sellerProfileId);
}

export async function sellerPublicMetroStaticSlugs() {
  return readSellerPublicMetroStaticSlugs(prisma);
}

export async function sellerPublicMetroMakers(
  viewerUserId: string | null,
  metroId: string,
  isMajor: boolean,
  limit = 24,
) {
  if (
    !/^[A-Za-z0-9._:-]{1,191}$/u.test(metroId)
    || typeof isMajor !== "boolean"
    || !Number.isSafeInteger(limit)
    || limit < 1
    || limit > 24
  ) {
    throw new RangeError("Seller public metro-maker input is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicMetroMakers(client, metroId, isMajor, limit));
  }
  return readSellerPublicMetroMakers(prisma, metroId, isMajor, limit);
}

export async function sellerPublicNearbyMetros(
  viewerUserId: string | null,
  metroId: string,
) {
  if (!/^[A-Za-z0-9._:-]{1,191}$/u.test(metroId)) {
    throw new RangeError("Seller public nearby-metro input is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicNearbyMetros(client, metroId));
  }
  return readSellerPublicNearbyMetros(prisma, metroId);
}

export async function sellerPublicFooterMetros() {
  return readSellerPublicFooterMetros(prisma);
}

export async function sellerPublicViewTarget(sellerProfileId: string) {
  if (sellerProfileId.length < 1 || sellerProfileId.length > 191) {
    throw new RangeError("Seller public view-target id is outside the supported range");
  }
  return readSellerPublicViewTarget(prisma, sellerProfileId);
}

export async function sellerPublicProfile(
  viewerUserId: string | null,
  sellerProfileId: string,
) {
  if (!/^[A-Za-z0-9._:-]{1,191}$/u.test(sellerProfileId)) {
    throw new RangeError("Seller public profile id is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicProfile(client, sellerProfileId));
  }
  return readSellerPublicProfile(prisma, sellerProfileId);
}

export async function sellerPublicBlogAuthor(sellerProfileId: string) {
  if (sellerProfileId.length < 1 || sellerProfileId.length > 191) {
    throw new RangeError("Seller public blog-author id is outside the supported range");
  }
  return readSellerPublicBlogAuthor(prisma, sellerProfileId);
}

export async function sellerPublicCustomerPhotoHeader(
  viewerUserId: string | null,
  sellerProfileId: string,
) {
  if (sellerProfileId.length < 1 || sellerProfileId.length > 191) {
    throw new RangeError("Seller customer-photo id is outside the supported range");
  }
  if (viewerUserId) {
    return withDbUserContext(viewerUserId, (client) =>
      readSellerPublicCustomerPhotoHeader(client, sellerProfileId));
  }
  return readSellerPublicCustomerPhotoHeader(prisma, sellerProfileId);
}

export async function sellerPublicReportTarget(
  sellerProfileId: string,
  reportedUserId: string,
) {
  if (
    sellerProfileId.length < 1
    || sellerProfileId.length > 191
    || reportedUserId.length < 1
    || reportedUserId.length > 191
  ) {
    throw new RangeError("Seller public report-target input is outside the supported range");
  }
  return readSellerPublicReportTarget(prisma, sellerProfileId, reportedUserId);
}

export async function sellerPublicSitemapPage(
  kind: SellerPublicSitemapKind,
  skip: number,
  take: number,
) {
  if (
    !["SELLERS", "CUSTOMER_PHOTOS"].includes(kind)
    || !Number.isSafeInteger(skip)
    || skip < 0
    || skip > 2_147_483_647
    || !Number.isSafeInteger(take)
    || take < 1
    || take > 50_000
  ) {
    throw new RangeError("Seller public sitemap page input is outside the supported range");
  }
  return readSellerPublicSitemapPage(prisma, kind, skip, take);
}
