import type { Category, ListingType, Prisma } from "@prisma/client";
import { CATEGORY_VALUES } from "@/lib/categories";
import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";

export type SavedSearchOwnerAccessClient = DbUserContextTransactionClient;
export type SavedSearchOwnerRpcClient = Pick<Prisma.TransactionClient, "$queryRaw">;
export type OwnerSavedSearchRow = Prisma.SavedSearchGetPayload<Record<string, never>>;

const OWNER_SAVED_SEARCH_CATEGORIES = new Set<string>(CATEGORY_VALUES);
const OWNER_SAVED_SEARCH_LISTING_TYPES = new Set<string>(["MADE_TO_ORDER", "IN_STOCK"]);

export type OwnerSavedSearchCriteria = {
  query: string | null;
  category: Category | null;
  listingType: ListingType | null;
  shipsWithinDays: number | null;
  minRating: number | null;
  lat: number | null;
  lng: number | null;
  radiusMiles: number | null;
  sort: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  tags: string[];
};

export function ownerSavedSearchWhere(
  userId: string,
  criteria: OwnerSavedSearchCriteria,
): Prisma.SavedSearchWhereInput {
  return {
    userId,
    query: criteria.query,
    category: criteria.category,
    listingType: criteria.listingType,
    shipsWithinDays: criteria.shipsWithinDays,
    minRating: criteria.minRating,
    lat: criteria.lat,
    lng: criteria.lng,
    radiusMiles: criteria.radiusMiles,
    sort: criteria.sort,
    minPrice: criteria.minPrice,
    maxPrice: criteria.maxPrice,
    tags: { equals: criteria.tags },
  };
}

export async function findDuplicateOwnerSavedSearch(
  userId: string,
  criteria: OwnerSavedSearchCriteria,
  db: SavedSearchOwnerAccessClient,
) {
  return db.savedSearch.findFirst({
    where: ownerSavedSearchWhere(userId, criteria),
    select: { id: true },
  });
}

export async function countOwnerSavedSearches(
  userId: string,
  db: SavedSearchOwnerAccessClient,
) {
  return db.savedSearch.count({ where: { userId } });
}

export async function createOwnerSavedSearch(
  userId: string,
  criteria: OwnerSavedSearchCriteria,
  db: SavedSearchOwnerAccessClient,
) {
  return db.savedSearch.create({
    data: {
      userId,
      query: criteria.query,
      category: criteria.category,
      listingType: criteria.listingType,
      shipsWithinDays: criteria.shipsWithinDays,
      minRating: criteria.minRating,
      lat: criteria.lat,
      lng: criteria.lng,
      radiusMiles: criteria.radiusMiles,
      sort: criteria.sort,
      minPrice: criteria.minPrice,
      maxPrice: criteria.maxPrice,
      tags: criteria.tags,
    },
    select: { id: true },
  });
}

export async function listOwnerSavedSearches(
  userId: string,
  db: SavedSearchOwnerRpcClient,
  { take, searchId }: { take?: number; searchId?: string } = {},
) {
  const normalizedUserId = normalizeDbUserContextUserId(userId);
  const takeValue = typeof take === "number" ? take : null;
  const searchIdValue = typeof searchId === "string" ? searchId : null;
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_saved_search_list(
        ${normalizedUserId}::text,
        ${takeValue}::integer,
        ${searchIdValue}::text
      )
  `;
  if (!Array.isArray(rows)) {
    throw new Error("SavedSearch owner RPC result invariant failed");
  }
  return rows.map((row) => ownerSavedSearchRow(row, normalizedUserId, searchIdValue));
}

export async function inspectOwnerSavedSearchCanary(
  userId: string,
  searchId: string,
  db: SavedSearchOwnerRpcClient,
) {
  const rows = await listOwnerSavedSearches(userId, db, { take: 2, searchId });
  return {
    exactMatch:
      rows.length === 1 &&
      rows[0]?.id === searchId &&
      rows[0]?.userId === userId,
    matchCount: rows.length,
  };
}

export async function deleteOwnerSavedSearch(
  userId: string,
  searchId: string,
  db: SavedSearchOwnerRpcClient,
) {
  const normalizedUserId = normalizeDbUserContextUserId(userId);
  const rows = await db.$queryRaw<unknown[]>`
    SELECT public.grainline_saved_search_delete_one(
      ${normalizedUserId}::text,
      ${searchId}::text
    )::integer AS "deletedCount"
  `;
  if (!Array.isArray(rows)) {
    throw new Error("SavedSearch delete RPC invariant failed");
  }
  const row = rows[0];
  const deletedCount = isRecord(row) ? row.deletedCount : null;
  if (
    rows.length !== 1 ||
    typeof deletedCount !== "number" ||
    !Number.isInteger(deletedCount) ||
    (deletedCount !== 0 && deletedCount !== 1)
  ) {
    throw new Error("SavedSearch delete RPC invariant failed");
  }
  return { count: deletedCount };
}

export async function deleteAllOwnerSavedSearches(
  userId: string,
  db: SavedSearchOwnerAccessClient,
) {
  return db.savedSearch.deleteMany({ where: { userId } });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function isNullableFiniteNumber(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isFinite(value));
}

function isNullableInteger(value: unknown): value is number | null {
  return value === null || Number.isInteger(value);
}

function ownerSavedSearchRow(
  value: unknown,
  expectedUserId: string,
  expectedSearchId: string | null,
): OwnerSavedSearchRow {
  if (
    !isRecord(value) ||
    typeof value.id !== "string" ||
    value.id.length === 0 ||
    value.userId !== expectedUserId ||
    (expectedSearchId !== null && value.id !== expectedSearchId) ||
    !isNullableString(value.query) ||
    !(
      value.category === null ||
      (typeof value.category === "string" && OWNER_SAVED_SEARCH_CATEGORIES.has(value.category))
    ) ||
    !(
      value.listingType === null ||
      (typeof value.listingType === "string" && OWNER_SAVED_SEARCH_LISTING_TYPES.has(value.listingType))
    ) ||
    !isNullableInteger(value.shipsWithinDays) ||
    !isNullableInteger(value.minRating) ||
    !isNullableFiniteNumber(value.lat) ||
    !isNullableFiniteNumber(value.lng) ||
    !isNullableInteger(value.radiusMiles) ||
    !isNullableString(value.sort) ||
    !isNullableInteger(value.minPrice) ||
    !isNullableInteger(value.maxPrice) ||
    !Array.isArray(value.tags) ||
    value.tags.some((tag) => typeof tag !== "string") ||
    typeof value.notifyEmail !== "boolean" ||
    !(value.createdAt instanceof Date) ||
    !Number.isFinite(value.createdAt.getTime())
  ) {
    throw new Error("SavedSearch owner RPC row invariant failed");
  }
  return {
    id: value.id,
    userId: value.userId,
    query: value.query,
    category: value.category,
    listingType: value.listingType,
    shipsWithinDays: value.shipsWithinDays,
    minRating: value.minRating,
    lat: value.lat,
    lng: value.lng,
    radiusMiles: value.radiusMiles,
    sort: value.sort,
    minPrice: value.minPrice,
    maxPrice: value.maxPrice,
    tags: [...value.tags],
    notifyEmail: value.notifyEmail,
    createdAt: value.createdAt,
  } as OwnerSavedSearchRow;
}
