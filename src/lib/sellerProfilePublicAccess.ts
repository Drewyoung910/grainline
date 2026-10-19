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
  approximate: true;
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

type PublicMapClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

function nullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
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

async function readSellerPublicMapPoints(client: PublicMapClient, limit: number) {
  const rows = await client.$queryRaw<SellerPublicMapPointRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_seller_public_map_points(${limit})
  `);
  return rows.map(parsePublicMapPoint);
}

async function readSellerPublicLocation(
  client: PublicMapClient,
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
    approximate: true as const,
  });
}

async function readSellerPublicBrowseNearbySellerIds(
  client: PublicMapClient,
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
