import {
  Category,
  ListingStatus,
  ListingType,
  Prisma,
} from "@prisma/client";

import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type CatalogClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

export type ListingPublicCatalogSort =
  | "newest"
  | "quality"
  | "popular"
  | "price_asc"
  | "price_desc";

export type ListingPublicCatalogFilter = Readonly<{
  tag?: string;
  category?: Category;
  metroId?: string;
  cityMetroId?: string;
  sellerId?: string;
  sort?: ListingPublicCatalogSort;
}>;

export type ListingPublicCatalogPhoto = Readonly<{
  id: string;
  url: string;
  altText: string | null;
}>;

export type ListingPublicCatalogItem = Readonly<{
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  listingType: ListingType;
  stockQuantity: number | null;
  sellerId: string;
  photos: ReadonlyArray<ListingPublicCatalogPhoto>;
}>;

export type ListingPublicCatalogPage = Readonly<{
  total: number;
  listings: ReadonlyArray<ListingPublicCatalogItem>;
}>;

type CatalogSourceRow = Readonly<{
  totalCount: unknown;
  listings: unknown;
}>;

const CATEGORIES = new Set<string>(Object.values(Category));
const LISTING_TYPES = new Set<string>(Object.values(ListingType));
const SORTS = new Set<ListingPublicCatalogSort>([
  "newest",
  "quality",
  "popular",
  "price_asc",
  "price_desc",
]);

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function validSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function validNullableNonnegativeInteger(value: unknown): value is number | null {
  return value === null || (validSafeInteger(value) && value >= 0);
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(
  value: Record<string, unknown>,
  expectedKeys: ReadonlySet<string>,
): boolean {
  const keys = Object.keys(value);
  return keys.length === expectedKeys.size
    && keys.every((key) => expectedKeys.has(key));
}

const PHOTO_KEYS = new Set(["id", "url", "altText"]);
const ITEM_KEYS = new Set([
  "id",
  "title",
  "priceCents",
  "currency",
  "status",
  "listingType",
  "stockQuantity",
  "sellerId",
  "photos",
]);

function parseTotal(value: unknown): number | null {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  return validSafeInteger(value) && value >= 0 ? value : null;
}

function parsePhotos(value: unknown): ReadonlyArray<ListingPublicCatalogPhoto> | null {
  if (!Array.isArray(value) || value.length > 2) return null;
  const ids = new Set<string>();
  const photos: ListingPublicCatalogPhoto[] = [];
  for (const candidate of value) {
    const photo = recordValue(candidate);
    if (
      !photo
      || !hasOnlyKeys(photo, PHOTO_KEYS)
      || !validId(photo.id)
      || ids.has(photo.id)
      || !isTextWithinCodePointRange(photo.url, 1, 2048)
      || !(
        photo.altText === null
        || isTextWithinCodePointRange(photo.altText, 0, 200)
      )
    ) return null;
    ids.add(photo.id);
    photos.push(Object.freeze({
      id: photo.id,
      url: photo.url,
      altText: photo.altText as string | null,
    }));
  }
  return Object.freeze(photos);
}

function parseItem(value: unknown): ListingPublicCatalogItem | null {
  const item = recordValue(value);
  if (!item || !hasOnlyKeys(item, ITEM_KEYS)) return null;
  const photos = parsePhotos(item.photos);
  if (
    !validId(item.id)
    || !isTextWithinCodePointRange(item.title, 1, 150)
    || !validSafeInteger(item.priceCents)
    || item.priceCents < 0
    || !isTextWithinCodePointRange(item.currency, 3, 3)
    || item.status !== ListingStatus.ACTIVE
    || typeof item.listingType !== "string"
    || !LISTING_TYPES.has(item.listingType)
    || !validNullableNonnegativeInteger(item.stockQuantity)
    || !validId(item.sellerId)
    || !photos
  ) return null;

  return Object.freeze({
    id: item.id,
    title: item.title,
    priceCents: item.priceCents,
    currency: item.currency,
    status: ListingStatus.ACTIVE,
    listingType: item.listingType as ListingType,
    stockQuantity: item.stockQuantity,
    sellerId: item.sellerId,
    photos,
  });
}

function normalizedFilter(filter: ListingPublicCatalogFilter) {
  if (
    filter.tag !== undefined
    && !isTextWithinCodePointRange(filter.tag, 1, 24)
  ) throw new RangeError("Public catalog tag is outside the supported range");
  if (filter.category !== undefined && !CATEGORIES.has(filter.category)) {
    throw new RangeError("Public catalog category is outside the supported range");
  }
  for (const value of [filter.metroId, filter.cityMetroId, filter.sellerId]) {
    if (value !== undefined && !validId(value)) {
      throw new RangeError("Public catalog id is outside the supported range");
    }
  }
  if (filter.metroId !== undefined && filter.cityMetroId !== undefined) {
    throw new RangeError("Public catalog location is ambiguous");
  }
  if (filter.sort !== undefined && !SORTS.has(filter.sort)) {
    throw new RangeError("Public catalog sort is outside the supported range");
  }
  return Object.freeze(Object.fromEntries(
    Object.entries(filter).filter(([, value]) => value !== undefined),
  ));
}

async function readCatalogPage(
  client: CatalogClient,
  filter: ListingPublicCatalogFilter,
  offset: number,
  limit: number,
): Promise<ListingPublicCatalogPage> {
  if (
    !Number.isSafeInteger(offset) || offset < 0 || offset > 12_000
    || !Number.isSafeInteger(limit) || limit < 0 || limit > 200
  ) throw new RangeError("Public catalog page bounds are outside the supported range");

  const sourceFilter = normalizedFilter(filter);
  const rows = await client.$queryRaw<CatalogSourceRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_listing_public_catalog_page(
        ${JSON.stringify(sourceFilter)}::jsonb,
        ${offset}::integer,
        ${limit}::integer
      )
  `);
  if (rows.length !== 1) {
    throw new Error("Public catalog authority returned an invalid result count");
  }
  const total = parseTotal(rows[0]?.totalCount);
  if (total === null || !Array.isArray(rows[0]?.listings)) {
    throw new Error("Public catalog authority returned an invalid result");
  }
  const listings = rows[0].listings.map(parseItem);
  if (listings.some((listing) => listing === null)) {
    throw new Error("Public catalog authority returned an invalid listing");
  }
  return Object.freeze({
    total,
    listings: Object.freeze(listings as ListingPublicCatalogItem[]),
  });
}

export function listingPublicCatalogPage(
  viewerUserId: string | null,
  filter: ListingPublicCatalogFilter,
  offset: number,
  limit: number,
) {
  if (viewerUserId !== null) {
    if (!validId(viewerUserId)) {
      throw new RangeError("Public catalog viewer is outside the supported range");
    }
    return withDbUserContext(
      viewerUserId,
      (client) => readCatalogPage(client, filter, offset, limit),
    );
  }
  return readCatalogPage(prisma, filter, offset, limit);
}

export async function listingPublicCatalogCount(
  viewerUserId: string | null,
  filter: ListingPublicCatalogFilter,
) {
  return (await listingPublicCatalogPage(viewerUserId, filter, 0, 0)).total;
}
