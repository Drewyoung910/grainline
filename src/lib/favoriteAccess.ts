import { Prisma } from "@prisma/client";
import {
  type DbUserContextTransactionClient,
  withDbUserContext,
} from "@/lib/dbUserContext";

export type FavoriteAccessClient = DbUserContextTransactionClient;

export const FAVORITE_LISTING_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/u;

export function isFavoriteListingId(value: string) {
  return FAVORITE_LISTING_ID_PATTERN.test(value);
}

export type FavoriteAddStatus = "OK" | "NOT_FOUND" | "SELF" | "BLOCKED";

type FavoriteAddRow = {
  resultStatus: string;
  title: string | null;
  ownerUserId: string | null;
  created: boolean;
};

type FavoriteListingIdRow = { listingId: string };

type FavoriteExportRow = {
  listingId: string;
  createdAt: Date;
  title: string;
  status: string;
};

function exactCount(value: unknown, label: string) {
  const count = typeof value === "bigint" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`${label} returned an invalid count`);
  }
  return count;
}

function assertListingIds(listingIds: string[]) {
  if (
    listingIds.length < 1
    || listingIds.length > 100
    || listingIds.some((id) => !isFavoriteListingId(id))
  ) {
    throw new RangeError("Favorite listing ids are outside the supported range");
  }
}

export async function ownerFavoriteListingIds(
  userId: string,
  listingIds: string[],
) {
  if (listingIds.length === 0) return new Set<string>();
  const uniqueListingIds = [...new Set(listingIds)];
  assertListingIds(uniqueListingIds);
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<FavoriteListingIdRow[]>`
      SELECT result."listingId"
        FROM public.grainline_favorite_owner_listing_ids(
          ${uniqueListingIds}::text[]
        ) AS result
    `;
    if (rows.some((row) => (
      typeof row.listingId !== "string"
      || !uniqueListingIds.includes(row.listingId)
    ))) {
      throw new TypeError("Favorite owner state returned an invalid listing id");
    }
    const saved = new Set(rows.map((row) => row.listingId));
    if (saved.size !== rows.length) {
      throw new TypeError("Favorite owner state returned duplicate listing ids");
    }
    return saved;
  });
}

export function addOwnerFavorite(userId: string, listingId: string) {
  if (!isFavoriteListingId(listingId)) {
    throw new RangeError("Favorite listing id is outside the supported range");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<FavoriteAddRow[]>`
      SELECT
        result."resultStatus",
        result.title,
        result."ownerUserId",
        result.created
      FROM public.grainline_favorite_owner_add(${listingId}::text) AS result
    `;
    const row = rows[0];
    if (
      rows.length !== 1
      || !row
      || !["OK", "NOT_FOUND", "SELF", "BLOCKED"].includes(row.resultStatus)
      || typeof row.created !== "boolean"
      || (row.resultStatus === "OK" && (
        typeof row.title !== "string"
        || row.title.length === 0
        || typeof row.ownerUserId !== "string"
        || row.ownerUserId.length === 0
      ))
      || (row.resultStatus !== "OK" && (
        row.title !== null
        || row.ownerUserId !== null
        || row.created
      ))
    ) {
      throw new TypeError("Favorite add authority returned an invalid result");
    }
    return row as FavoriteAddRow & { resultStatus: FavoriteAddStatus };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export function removeOwnerFavorite(userId: string, listingId: string) {
  if (!isFavoriteListingId(listingId)) {
    throw new RangeError("Favorite listing id is outside the supported range");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
      SELECT public.grainline_favorite_owner_remove(${listingId}::text) AS value
    `;
    if (rows.length !== 1) {
      throw new TypeError("Favorite remove authority returned invalid cardinality");
    }
    const deleted = exactCount(rows[0]?.value, "Favorite remove authority");
    if (deleted > 1) {
      throw new TypeError("Favorite remove authority deleted too many rows");
    }
    return deleted;
  });
}

export function ownerFavoriteExportRows(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<FavoriteExportRow[]>`
      SELECT * FROM public.grainline_favorite_owner_export()
    `;
    if (rows.some((row) => (
      typeof row.listingId !== "string"
      || !(row.createdAt instanceof Date)
      || typeof row.title !== "string"
      || typeof row.status !== "string"
    ))) {
      throw new TypeError("Favorite export authority returned an invalid row");
    }
    return rows.map((row) => ({
      listingId: row.listingId,
      createdAt: row.createdAt,
      listing: { title: row.title, status: row.status },
    }));
  });
}

export function sellerFavoriteRangeCount(
  userId: string,
  startAt: Date,
  endAt: Date,
  endExclusive: boolean,
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
      SELECT public.grainline_favorite_seller_range_count(
        ${startAt}::timestamp,
        ${endAt}::timestamp,
        ${endExclusive}::boolean
      ) AS value
    `;
    if (rows.length !== 1) {
      throw new TypeError("Favorite seller range authority returned invalid cardinality");
    }
    return exactCount(rows[0]?.value, "Favorite seller range authority");
  });
}

async function cleanupCount(
  rows: Array<{ value: bigint | number }>,
  label: string,
) {
  if (rows.length !== 1) throw new TypeError(`${label} returned invalid cardinality`);
  return exactCount(rows[0]?.value, label);
}

export async function deleteFavoritesForSellerListing(
  client: FavoriteAccessClient,
  listingId: string,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_favorite_seller_listing_cleanup(
      ${listingId}::text
    ) AS value
  `;
  return cleanupCount(rows, "Favorite seller cleanup authority");
}

export async function deleteFavoritesForAdminListing(
  client: FavoriteAccessClient,
  listingId: string,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_favorite_admin_listing_cleanup(
      ${listingId}::text
    ) AS value
  `;
  return cleanupCount(rows, "Favorite admin cleanup authority");
}

export async function deleteFavoritesForBlockedPair(
  client: FavoriteAccessClient,
  targetUserId: string,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_favorite_block_cleanup(
      ${targetUserId}::text
    ) AS value
  `;
  return cleanupCount(rows, "Favorite block cleanup authority");
}

export function deleteAllOwnerFavorites(
  userId: string,
  client: FavoriteAccessClient,
) {
  return client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_favorite_owner_delete_all(
      ${userId}::text
    ) AS value
  `.then((rows) => cleanupCount(rows, "Favorite owner delete-all authority"));
}
