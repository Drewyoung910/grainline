import { Category, ListingStatus, ListingType } from "@prisma/client";

import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";
import { isTextWithinCodePointRange } from "@/lib/textLength";

type OwnerCatalogClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

export type ListingOwnerCatalogSort =
  | "newest"
  | "popular"
  | "price_asc"
  | "price_desc";

export type ListingOwnerCatalogFilter = Readonly<{
  status?: ListingStatus;
  category?: Category;
  tag?: string;
  sort?: ListingOwnerCatalogSort;
  includeCategoryCounts?: boolean;
}>;

export type ListingOwnerCatalogItem = Readonly<{
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: ListingStatus;
  isPrivate: boolean;
  listingType: ListingType;
  stockQuantity: number | null;
  photos: ReadonlyArray<Readonly<{
    url: string;
    altText: string | null;
  }>>;
}>;

export type ListingOwnerCatalogPage = Readonly<{
  total: number;
  listings: ReadonlyArray<ListingOwnerCatalogItem>;
  categoryCounts: ReadonlyArray<Readonly<{
    category: Category;
    count: number;
  }>>;
}>;

type OwnerCatalogRow = Readonly<{
  totalCount: unknown;
  listings: unknown;
  categoryCounts: unknown;
}>;

const STATUSES = new Set<string>(Object.values(ListingStatus));
const CATEGORIES = new Set<string>(Object.values(Category));
const LISTING_TYPES = new Set<string>(Object.values(ListingType));
const SORTS = new Set<ListingOwnerCatalogSort>([
  "newest",
  "popular",
  "price_asc",
  "price_desc",
]);
const ITEM_KEYS = new Set([
  "id",
  "title",
  "priceCents",
  "currency",
  "status",
  "isPrivate",
  "listingType",
  "stockQuantity",
  "photos",
]);
const PHOTO_KEYS = new Set(["url", "altText"]);
const CATEGORY_COUNT_KEYS = new Set(["category", "count"]);

function validId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9._:-]{1,191}$/u.test(value);
}

function validSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function parseCount(value: unknown): number | null {
  if (typeof value === "bigint") {
    return value >= 0n && value <= BigInt(Number.MAX_SAFE_INTEGER)
      ? Number(value)
      : null;
  }
  return validSafeInteger(value) && value >= 0 ? value : null;
}

function recordValue(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function hasOnlyKeys(value: Record<string, unknown>, keys: ReadonlySet<string>) {
  const actual = Object.keys(value);
  return actual.length === keys.size && actual.every((key) => keys.has(key));
}

function parseListings(value: unknown): ReadonlyArray<ListingOwnerCatalogItem> | null {
  if (!Array.isArray(value) || value.length > 100) return null;
  const ids = new Set<string>();
  const result: ListingOwnerCatalogItem[] = [];
  for (const candidate of value) {
    const item = recordValue(candidate);
    if (!item || !hasOnlyKeys(item, ITEM_KEYS) || !Array.isArray(item.photos)) return null;
    const photos = item.photos.map((photoCandidate) => {
      const photo = recordValue(photoCandidate);
      if (
        !photo
        || !hasOnlyKeys(photo, PHOTO_KEYS)
        || !isTextWithinCodePointRange(photo.url, 1, 2048)
        || !(
          photo.altText === null
          || isTextWithinCodePointRange(photo.altText, 0, 200)
        )
      ) return null;
      return Object.freeze({
        url: photo.url,
        altText: photo.altText as string | null,
      });
    });
    if (
      !validId(item.id)
      || ids.has(item.id)
      || !isTextWithinCodePointRange(item.title, 1, 150)
      || !validSafeInteger(item.priceCents)
      || item.priceCents < 1
      || !isTextWithinCodePointRange(item.currency, 3, 3)
      || typeof item.status !== "string"
      || !STATUSES.has(item.status)
      || typeof item.isPrivate !== "boolean"
      || typeof item.listingType !== "string"
      || !LISTING_TYPES.has(item.listingType)
      || !(
        item.stockQuantity === null
        || (validSafeInteger(item.stockQuantity) && item.stockQuantity >= 0)
      )
      || photos.length > 1
      || photos.some((photo) => photo === null)
    ) return null;
    ids.add(item.id);
    result.push(Object.freeze({
      id: item.id,
      title: item.title,
      priceCents: item.priceCents,
      currency: item.currency,
      status: item.status as ListingStatus,
      isPrivate: item.isPrivate,
      listingType: item.listingType as ListingType,
      stockQuantity: item.stockQuantity as number | null,
      photos: Object.freeze(photos as Array<NonNullable<(typeof photos)[number]>>),
    }));
  }
  return Object.freeze(result);
}

function parseCategoryCounts(value: unknown) {
  if (!Array.isArray(value) || value.length > CATEGORIES.size) return null;
  const categories = new Set<string>();
  const result: Array<Readonly<{ category: Category; count: number }>> = [];
  for (const candidate of value) {
    const row = recordValue(candidate);
    const count = row ? parseCount(row.count) : null;
    if (
      !row
      || !hasOnlyKeys(row, CATEGORY_COUNT_KEYS)
      || typeof row.category !== "string"
      || !CATEGORIES.has(row.category)
      || categories.has(row.category)
      || count === null
      || count < 1
    ) return null;
    categories.add(row.category);
    result.push(Object.freeze({ category: row.category as Category, count }));
  }
  return Object.freeze(result);
}

function normalizeFilter(filter: ListingOwnerCatalogFilter) {
  if (filter.status !== undefined && !STATUSES.has(filter.status)) {
    throw new RangeError("Listing owner-catalog status is invalid");
  }
  if (filter.category !== undefined && !CATEGORIES.has(filter.category)) {
    throw new RangeError("Listing owner-catalog category is invalid");
  }
  if (
    filter.tag !== undefined
    && !isTextWithinCodePointRange(filter.tag, 1, 24)
  ) throw new RangeError("Listing owner-catalog tag is invalid");
  if (filter.sort !== undefined && !SORTS.has(filter.sort)) {
    throw new RangeError("Listing owner-catalog sort is invalid");
  }
  if (
    filter.includeCategoryCounts !== undefined
    && typeof filter.includeCategoryCounts !== "boolean"
  ) throw new RangeError("Listing owner-catalog facet request is invalid");

  return Object.freeze({
    ...(filter.status === undefined ? {} : { status: filter.status }),
    ...(filter.category === undefined ? {} : { category: filter.category }),
    ...(filter.tag === undefined ? {} : { tag: filter.tag }),
    sort: filter.sort ?? "newest",
    ...(filter.includeCategoryCounts === undefined
      ? {}
      : { includeCategoryCounts: filter.includeCategoryCounts }),
  });
}

async function readListingOwnerCatalogPage(
  client: OwnerCatalogClient,
  sellerProfileId: string,
  filter: ListingOwnerCatalogFilter,
  offset: number,
  limit: number,
): Promise<ListingOwnerCatalogPage> {
  if (!validId(sellerProfileId)) {
    throw new RangeError("Listing owner-catalog seller is invalid");
  }
  if (
    !Number.isSafeInteger(offset)
    || offset < 0
    || offset > 10_000
    || !Number.isSafeInteger(limit)
    || limit < 0
    || limit > 100
  ) throw new RangeError("Listing owner-catalog page is invalid");

  const normalized = normalizeFilter(filter);
  const rows = await client.$queryRaw<OwnerCatalogRow[]>`
    SELECT *
      FROM public.grainline_listing_owner_catalog_page(
        ${sellerProfileId}::text,
        ${JSON.stringify(normalized)}::jsonb,
        ${offset}::integer,
        ${limit}::integer
      )
  `;
  if (rows.length !== 1) {
    throw new Error("Listing owner-catalog authority returned invalid cardinality");
  }
  const total = parseCount(rows[0].totalCount);
  const listings = parseListings(rows[0].listings);
  const categoryCounts = parseCategoryCounts(rows[0].categoryCounts);
  if (total === null || !listings || !categoryCounts || listings.length > limit) {
    throw new Error("Listing owner-catalog authority returned an invalid result");
  }
  return Object.freeze({ total, listings, categoryCounts });
}

export function listingOwnerCatalogPage(
  actorUserId: string,
  sellerProfileId: string,
  filter: ListingOwnerCatalogFilter,
  offset: number,
  limit: number,
) {
  return withDbUserContext(actorUserId, (client) => readListingOwnerCatalogPage(
    client,
    sellerProfileId,
    filter,
    offset,
    limit,
  ));
}
