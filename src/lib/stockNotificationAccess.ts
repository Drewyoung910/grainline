import { randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  withDbUserContext,
  type DbUserContextTransactionClient,
} from "@/lib/dbUserContext";

export type StockNotificationAccessClient = DbUserContextTransactionClient;

export type StockNotificationSubscribeStatus =
  | "OK"
  | "UNAVAILABLE"
  | "SELF"
  | "BLOCKED";

type SubscribeRow = {
  resultStatus: string;
  subscribed: boolean;
};

function exactCount(value: unknown, label: string) {
  const count = typeof value === "bigint" ? Number(value) : value;
  if (typeof count !== "number" || !Number.isSafeInteger(count) || count < 0) {
    throw new TypeError(`${label} returned an invalid count`);
  }
  return count;
}

export async function subscribeOwnerStockNotification(
  userId: string,
  listingId: string,
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<SubscribeRow[]>`
      SELECT
        result."resultStatus",
        result.subscribed
      FROM public.grainline_stock_notification_owner_subscribe(
        ${randomUUID()}::text,
        ${listingId}::text
      ) AS result
    `;
    const row = rows[0];
    if (
      rows.length !== 1
      || !row
      || !["OK", "UNAVAILABLE", "SELF", "BLOCKED"].includes(row.resultStatus)
      || typeof row.subscribed !== "boolean"
      || row.subscribed !== (row.resultStatus === "OK")
    ) {
      throw new TypeError("StockNotification subscribe authority returned an invalid result");
    }
    return row as {
      resultStatus: StockNotificationSubscribeStatus;
      subscribed: boolean;
    };
  }, { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted });
}

export function findOwnerStockNotification(
  userId: string,
  listingId: string,
) {
  return withDbUserContext(userId, (client) =>
    client.stockNotification.findUnique({
      where: { listingId_userId: { listingId, userId } },
      select: { id: true },
    }));
}

export function deleteOwnerStockNotification(
  userId: string,
  listingId: string,
) {
  return withDbUserContext(userId, (client) =>
    client.stockNotification.deleteMany({ where: { listingId, userId } }));
}

type SellerCountRow = {
  listingId: string;
  value: bigint | number;
};

export async function sellerStockNotificationCounts(
  userId: string,
  listingIds: string[],
) {
  if (listingIds.length === 0) return new Map<string, number>();
  if (listingIds.length > 100 || listingIds.some((id) => !id || id.length > 191)) {
    throw new RangeError("StockNotification seller count ids are outside the supported range");
  }
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<SellerCountRow[]>`
      SELECT result."listingId", result.value
      FROM public.grainline_stock_notification_seller_counts(
        ${listingIds}::text[]
      ) AS result
    `;
    const counts = new Map<string, number>();
    for (const row of rows) {
      if (
        typeof row.listingId !== "string"
        || counts.has(row.listingId)
        || !listingIds.includes(row.listingId)
      ) {
        throw new TypeError("StockNotification seller count authority returned an invalid listing");
      }
      counts.set(row.listingId, exactCount(row.value, "StockNotification seller count authority"));
    }
    return counts;
  });
}

export function sellerStockNotificationRangeCount(
  userId: string,
  startAt: Date,
  endAt: Date,
  endExclusive: boolean,
) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
      SELECT public.grainline_stock_notification_seller_range_count(
        ${startAt}::timestamp,
        ${endAt}::timestamp,
        ${endExclusive}::boolean
      ) AS value
    `;
    if (rows.length !== 1) {
      throw new TypeError("StockNotification seller range authority returned invalid cardinality");
    }
    return exactCount(rows[0]?.value, "StockNotification seller range authority");
  });
}

export async function stockNotificationRestockCandidates(
  restockAuditId: string,
  limit: number,
) {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 5000) {
    throw new RangeError("StockNotification candidate limit is outside the supported range");
  }
  const rows = await prisma.$queryRaw<Array<{ stockNotificationId: string }>>`
    SELECT result."stockNotificationId"
    FROM public.grainline_stock_notification_restock_candidates(
      ${restockAuditId}::text,
      ${limit}::integer
    ) AS result
  `;
  if (rows.some((row) => typeof row.stockNotificationId !== "string")) {
    throw new TypeError("StockNotification candidate authority returned an invalid id");
  }
  return rows;
}

async function cleanupCount(
  rows: Array<{ value: bigint | number }>,
  label: string,
) {
  if (rows.length !== 1) throw new TypeError(`${label} returned invalid cardinality`);
  return exactCount(rows[0]?.value, label);
}

export async function deleteStockNotificationsForSellerListing(
  client: StockNotificationAccessClient,
  listingId: string,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_stock_notification_seller_listing_cleanup(
      ${listingId}::text
    ) AS value
  `;
  return cleanupCount(rows, "StockNotification seller cleanup authority");
}

export async function deleteStockNotificationsForAdminListing(
  client: StockNotificationAccessClient,
  listingId: string,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_stock_notification_admin_listing_cleanup(
      ${listingId}::text
    ) AS value
  `;
  return cleanupCount(rows, "StockNotification admin cleanup authority");
}

export async function deleteStockNotificationsForBlockedPair(
  client: StockNotificationAccessClient,
  targetUserId: string,
) {
  const rows = await client.$queryRaw<Array<{ value: bigint | number }>>`
    SELECT public.grainline_stock_notification_block_cleanup(
      ${targetUserId}::text
    ) AS value
  `;
  return cleanupCount(rows, "StockNotification block cleanup authority");
}

export function deleteAllOwnerStockNotifications(
  userId: string,
  client: StockNotificationAccessClient,
) {
  return client.stockNotification.deleteMany({ where: { userId } });
}

export type OwnerStockNotificationExportRow = {
  listingId: string;
  createdAt: Date;
  title: string;
  status: string;
};

export function ownerStockNotificationExportRows(userId: string) {
  return withDbUserContext(userId, async (client) => {
    const rows = await client.$queryRaw<OwnerStockNotificationExportRow[]>`
      SELECT * FROM public.grainline_stock_notification_owner_export()
    `;
    if (rows.some((row) => (
      typeof row.listingId !== "string"
      || !(row.createdAt instanceof Date)
      || typeof row.title !== "string"
      || typeof row.status !== "string"
    ))) {
      throw new TypeError("StockNotification export authority returned an invalid row");
    }
    return rows.map((row) => ({
      listingId: row.listingId,
      createdAt: row.createdAt,
      listing: { title: row.title, status: row.status },
    }));
  });
}
