import { Prisma } from "@prisma/client";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";

type OrderAccountDeletionClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type OrderAccountDeletionBlockerCounts = Readonly<{
  buyerOrders: number;
  sellerOrders: number;
}>;

export type OrderAccountDeletionScrubResult = Readonly<{
  reviewNotesRedacted: number;
  buyerOrdersScrubbed: number;
  sellerOrdersScrubbed: number;
  shippingQuotesDeleted: number;
}>;

function count(value: unknown, label: string) {
  const result = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(result) || result < 0) {
    throw new TypeError(`${label} is invalid`);
  }
  return result;
}

function oneRow(rows: unknown[], label: string) {
  if (rows.length !== 1 || !rows[0] || typeof rows[0] !== "object") {
    throw new TypeError(`${label} returned an invalid result`);
  }
  return rows[0] as Record<string, unknown>;
}

function sensitiveValues(values: string[]) {
  if (values.length > 128) {
    throw new TypeError("Order account-deletion sensitive value count is invalid");
  }
  return values.map((value) => {
    if (typeof value !== "string" || value.length < 1 || value.length > 2048) {
      throw new TypeError("Order account-deletion sensitive value is invalid");
    }
    return value;
  });
}

export async function getOrderAccountDeletionBlockerCounts(
  input: { actorUserId: string },
  client: OrderAccountDeletionClient,
): Promise<OrderAccountDeletionBlockerCounts> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const rows = await client.$queryRaw<unknown[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_account_deletion_blockers(
        ${actorUserId}
      )
  `);
  const row = oneRow(rows, "Order account-deletion blocker authority");
  return Object.freeze({
    buyerOrders: count(row.buyer_order_count, "Buyer Order blocker count"),
    sellerOrders: count(row.seller_order_count, "Seller Order blocker count"),
  });
}

export async function scrubOrderDataForAccountDeletion(
  input: {
    actorUserId: string;
    additionalSensitiveValues: string[];
  },
  client: OrderAccountDeletionClient,
): Promise<OrderAccountDeletionScrubResult> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const values = sensitiveValues(input.additionalSensitiveValues);
  const valuesSql = values.length > 0
    ? Prisma.sql`ARRAY[${Prisma.join(values)}]::text[]`
    : Prisma.sql`ARRAY[]::text[]`;
  const rows = await client.$queryRaw<unknown[]>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_account_deletion_scrub(
        ${actorUserId},
        ${valuesSql}
      )
  `);
  const row = oneRow(rows, "Order account-deletion scrub authority");
  return Object.freeze({
    reviewNotesRedacted: count(
      row.review_notes_redacted,
      "Order review-note redaction count",
    ),
    buyerOrdersScrubbed: count(
      row.buyer_orders_scrubbed,
      "Buyer Order scrub count",
    ),
    sellerOrdersScrubbed: count(
      row.seller_orders_scrubbed,
      "Seller Order scrub count",
    ),
    shippingQuotesDeleted: count(
      row.shipping_quotes_deleted,
      "Order shipping-quote deletion count",
    ),
  });
}
