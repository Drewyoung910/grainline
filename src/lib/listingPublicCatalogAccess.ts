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
import {
  hasInvalidPublicCatalogPriceRange,
  isPublicCatalogTagCandidate,
} from "@/lib/listingPublicCatalogFilter";

type CatalogClient = Pick<DbUserContextTransactionClient, "$queryRaw">;

export type ListingPublicCatalogSort =
  | "newest"
  | "quality"
  | "relevant"
  | "popular"
  | "price_asc"
  | "price_desc";

export type ListingPublicCatalogFilter = Readonly<{
  tag?: string;
  category?: Category;
  metroId?: string;
  cityMetroId?: string;
  sellerId?: string;
  listingIds?: ReadonlyArray<string>;
  excludeListingId?: string;
  query?: string;
  normalizedSellerQuery?: string;
  partialTagMatches?: ReadonlyArray<string>;
  selectedTags?: ReadonlyArray<string>;
  minPriceCents?: number;
  maxPriceCents?: number;
  listingType?: ListingType;
  shipsWithinDays?: number;
  minimumSellerRating?: number;
  locationLat?: number;
  locationLng?: number;
  locationRadiusMiles?: number;
  sort?: ListingPublicCatalogSort;
  includeCategoryCounts?: boolean;
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
  shipsWithinDays: number | null;
  processingTimeMinDays: number | null;
  processingTimeMaxDays: number | null;
  sellerId: string;
  photos: ReadonlyArray<ListingPublicCatalogPhoto>;
}>;

export type ListingPublicCatalogCategoryCount = Readonly<{
  category: Category;
  count: number;
}>;

export type ListingPublicCatalogPage = Readonly<{
  total: number;
  listings: ReadonlyArray<ListingPublicCatalogItem>;
  categoryCounts: ReadonlyArray<ListingPublicCatalogCategoryCount>;
}>;

type CatalogSourceRow = Readonly<{
  totalCount: unknown;
  listings: unknown;
  categoryCounts: unknown;
}>;

type TitleSuggestionSourceRow = Readonly<{
  matchKind: unknown;
  id: unknown;
  title: unknown;
}>;

export type ListingPublicTitleSuggestion = Readonly<{
  id: string;
  title: string;
}>;

export type ListingPublicTitleSuggestions = Readonly<{
  exact: ReadonlyArray<ListingPublicTitleSuggestion>;
  fuzzy: ReadonlyArray<ListingPublicTitleSuggestion>;
}>;

const CATEGORIES = new Set<string>(Object.values(Category));
const LISTING_TYPES = new Set<string>(Object.values(ListingType));
const SORTS = new Set<ListingPublicCatalogSort>([
  "newest",
  "quality",
  "relevant",
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
  "shipsWithinDays",
  "processingTimeMinDays",
  "processingTimeMaxDays",
  "sellerId",
  "photos",
]);
const CATEGORY_COUNT_KEYS = new Set(["category", "count"]);

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
    || !validNullableNonnegativeInteger(item.shipsWithinDays)
    || !validNullableNonnegativeInteger(item.processingTimeMinDays)
    || !validNullableNonnegativeInteger(item.processingTimeMaxDays)
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
    shipsWithinDays: item.shipsWithinDays,
    processingTimeMinDays: item.processingTimeMinDays,
    processingTimeMaxDays: item.processingTimeMaxDays,
    sellerId: item.sellerId,
    photos,
  });
}

function parseCategoryCounts(
  value: unknown,
): ReadonlyArray<ListingPublicCatalogCategoryCount> | null {
  if (!Array.isArray(value) || value.length > CATEGORIES.size) return null;
  const categories = new Set<string>();
  const counts: ListingPublicCatalogCategoryCount[] = [];
  for (const candidate of value) {
    const count = recordValue(candidate);
    if (
      !count
      || !hasOnlyKeys(count, CATEGORY_COUNT_KEYS)
      || typeof count.category !== "string"
      || !CATEGORIES.has(count.category)
      || categories.has(count.category)
      || !validSafeInteger(count.count)
      || count.count < 1
    ) return null;
    categories.add(count.category);
    counts.push(Object.freeze({
      category: count.category as Category,
      count: count.count,
    }));
  }
  return Object.freeze(counts);
}

function normalizedFilter(filter: ListingPublicCatalogFilter) {
  if (
    filter.tag !== undefined
    && !isPublicCatalogTagCandidate(filter.tag)
  ) throw new RangeError("Public catalog tag is outside the supported range");
  if (filter.category !== undefined && !CATEGORIES.has(filter.category)) {
    throw new RangeError("Public catalog category is outside the supported range");
  }
  if (
    filter.query !== undefined
    && !isTextWithinCodePointRange(filter.query, 1, 200)
  ) throw new RangeError("Public catalog query is outside the supported range");
  if (
    filter.normalizedSellerQuery !== undefined
    && !isTextWithinCodePointRange(filter.normalizedSellerQuery, 1, 100)
  ) throw new RangeError("Public catalog seller query is outside the supported range");
  for (const [values, maximum, label] of [
    [filter.partialTagMatches, 20, "partial tags"],
    [filter.selectedTags, 10, "selected tags"],
  ] as const) {
    if (values === undefined) continue;
    if (
      !Array.isArray(values)
      || values.length > maximum
      || new Set(values).size !== values.length
      || values.some((value) => !isPublicCatalogTagCandidate(value))
    ) throw new RangeError(`Public catalog ${label} are outside the supported range`);
  }
  for (const [value, maximum, label] of [
    [filter.minPriceCents, 50_000_000, "minimum price"],
    [filter.maxPriceCents, 50_000_000, "maximum price"],
  ] as const) {
    if (
      value !== undefined
      && (!validSafeInteger(value) || value < 0 || value > maximum)
    ) throw new RangeError(`Public catalog ${label} is outside the supported range`);
  }
  if (
    hasInvalidPublicCatalogPriceRange(
      filter.minPriceCents,
      filter.maxPriceCents,
    )
  ) throw new RangeError("Public catalog price range is invalid");
  if (
    filter.listingType !== undefined
    && !LISTING_TYPES.has(filter.listingType)
  ) throw new RangeError("Public catalog listing type is outside the supported range");
  if (
    filter.shipsWithinDays !== undefined
    && (
      !validSafeInteger(filter.shipsWithinDays)
      || filter.shipsWithinDays < 1
      || filter.shipsWithinDays > 365
    )
  ) throw new RangeError("Public catalog shipping window is outside the supported range");
  if (
    filter.minimumSellerRating !== undefined
    && (
      !Number.isFinite(filter.minimumSellerRating)
      || filter.minimumSellerRating < 1
      || filter.minimumSellerRating > 5
    )
  ) throw new RangeError("Public catalog seller rating is outside the supported range");
  const locationValues = [
    filter.locationLat,
    filter.locationLng,
    filter.locationRadiusMiles,
  ];
  const locationValueCount = locationValues.filter((value) => value !== undefined).length;
  if (
    (locationValueCount !== 0 && locationValueCount !== 3)
    || (filter.locationLat !== undefined && (
      !Number.isFinite(filter.locationLat)
      || filter.locationLat < -90
      || filter.locationLat > 90
    ))
    || (filter.locationLng !== undefined && (
      !Number.isFinite(filter.locationLng)
      || filter.locationLng < -180
      || filter.locationLng > 180
    ))
    || (filter.locationRadiusMiles !== undefined && (
      !Number.isFinite(filter.locationRadiusMiles)
      || filter.locationRadiusMiles < 1
      || filter.locationRadiusMiles > 500
    ))
  ) throw new RangeError("Public catalog location is outside the supported range");
  for (const value of [filter.metroId, filter.cityMetroId, filter.sellerId]) {
    if (value !== undefined && !validId(value)) {
      throw new RangeError("Public catalog id is outside the supported range");
    }
  }
  if (
    filter.listingIds !== undefined
    && (
      !Array.isArray(filter.listingIds)
      || filter.listingIds.length < 1
      || filter.listingIds.length > 20
      || new Set(filter.listingIds).size !== filter.listingIds.length
      || filter.listingIds.some((value) => !validId(value))
    )
  ) throw new RangeError("Public catalog listing ids are outside the supported range");
  if (
    filter.excludeListingId !== undefined
    && !validId(filter.excludeListingId)
  ) throw new RangeError("Public catalog excluded listing id is outside the supported range");
  if (filter.metroId !== undefined && filter.cityMetroId !== undefined) {
    throw new RangeError("Public catalog location is ambiguous");
  }
  if (filter.sort !== undefined && !SORTS.has(filter.sort)) {
    throw new RangeError("Public catalog sort is outside the supported range");
  }
  if (filter.sort === "relevant" && filter.query === undefined) {
    throw new RangeError("Public catalog relevance sort requires a query");
  }
  if (
    filter.includeCategoryCounts !== undefined
    && typeof filter.includeCategoryCounts !== "boolean"
  ) {
    throw new RangeError("Public catalog category-count request is invalid");
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
  const categoryCounts = parseCategoryCounts(rows[0]?.categoryCounts);
  if (
    total === null
    || !Array.isArray(rows[0]?.listings)
    || !categoryCounts
  ) {
    throw new Error("Public catalog authority returned an invalid result");
  }
  const listings = rows[0].listings.map(parseItem);
  if (listings.some((listing) => listing === null)) {
    throw new Error("Public catalog authority returned an invalid listing");
  }
  return Object.freeze({
    total,
    listings: Object.freeze(listings as ListingPublicCatalogItem[]),
    categoryCounts,
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

async function readPublicTitleSuggestions(
  client: CatalogClient,
  query: string,
): Promise<ListingPublicTitleSuggestions> {
  if (
    !isTextWithinCodePointRange(query, 2, 80)
    || query !== query.trim()
    || query.includes("\0")
  ) throw new RangeError("Public Listing title-suggestion query is outside the supported range");

  const rows = await client.$queryRaw<TitleSuggestionSourceRow[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_listing_public_title_suggestions(${query}::text)
  `);
  if (rows.length > 6) {
    throw new Error("Public Listing title-suggestion authority exceeded its result bound");
  }
  const exact: ListingPublicTitleSuggestion[] = [];
  const fuzzy: ListingPublicTitleSuggestion[] = [];
  const ids = new Set<string>();
  for (const row of rows) {
    if (
      (row.matchKind !== "exact" && row.matchKind !== "fuzzy")
      || !validId(row.id)
      || typeof row.title !== "string"
      || !isTextWithinCodePointRange(row.title, 1, 150)
      || ids.has(row.id)
    ) {
      throw new Error("Public Listing title-suggestion authority returned an invalid row");
    }
    ids.add(row.id);
    const suggestion = Object.freeze({ id: row.id, title: row.title });
    if (row.matchKind === "exact") exact.push(suggestion);
    else fuzzy.push(suggestion);
  }
  if (exact.length > 4 || fuzzy.length > 2) {
    throw new Error("Public Listing title-suggestion authority exceeded a group bound");
  }
  return Object.freeze({
    exact: Object.freeze(exact),
    fuzzy: Object.freeze(fuzzy),
  });
}

export function listingPublicTitleSuggestions(
  viewerUserId: string | null,
  query: string,
) {
  if (viewerUserId !== null) {
    if (!validId(viewerUserId)) {
      throw new RangeError("Public Listing title-suggestion viewer is outside the supported range");
    }
    return withDbUserContext(
      viewerUserId,
      (client) => readPublicTitleSuggestions(client, query),
    );
  }
  return readPublicTitleSuggestions(prisma, query);
}
