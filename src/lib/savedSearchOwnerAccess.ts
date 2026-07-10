import type { Category, ListingType, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

export type SavedSearchOwnerAccessClient = Pick<Prisma.TransactionClient, "savedSearch">;

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
  db: SavedSearchOwnerAccessClient = prisma,
) {
  return db.savedSearch.findFirst({
    where: ownerSavedSearchWhere(userId, criteria),
    select: { id: true },
  });
}

export async function countOwnerSavedSearches(
  userId: string,
  db: SavedSearchOwnerAccessClient = prisma,
) {
  return db.savedSearch.count({ where: { userId } });
}

export async function createOwnerSavedSearch(
  userId: string,
  criteria: OwnerSavedSearchCriteria,
  db: SavedSearchOwnerAccessClient = prisma,
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
  { take }: { take?: number } = {},
  db: SavedSearchOwnerAccessClient = prisma,
) {
  const query: Prisma.SavedSearchFindManyArgs = {
    where: { userId },
    orderBy: { createdAt: "desc" },
    ...(typeof take === "number" ? { take } : {}),
  };
  return db.savedSearch.findMany(query);
}

export async function deleteOwnerSavedSearch(
  userId: string,
  searchId: string,
  db: SavedSearchOwnerAccessClient = prisma,
) {
  return db.savedSearch.deleteMany({ where: { id: searchId, userId } });
}
