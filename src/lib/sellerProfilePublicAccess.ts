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

type SellerPublicMapPointRow = {
  id: unknown;
  displayName: unknown;
  city: unknown;
  state: unknown;
  publicLat: unknown;
  publicLng: unknown;
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
