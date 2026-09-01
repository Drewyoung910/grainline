import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  buyerOrderExportPageFromRows,
  sellerOrderExportPageFromRows,
  type BuyerOrderExport,
  type OrderExportCursor,
  type SellerOrderExport,
} from "@/lib/orderParticipantExportState";

type OrderExportClient = Pick<Prisma.TransactionClient, "$queryRaw">;
const PAGE_LIMIT = 25;

async function exportPages<T>(input: {
  actorUserId: string;
  participant: "buyer" | "seller";
  client: OrderExportClient;
  parse: (
    rows: Array<Record<string, unknown>>,
    limit: number,
  ) => { values: T[]; cursor: OrderExportCursor | null };
}) {
  const exported: T[] = [];
  const ids = new Set<string>();
  let before: OrderExportCursor | null = null;

  for (;;) {
    const rows = input.participant === "buyer"
      ? await input.client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          SELECT *
            FROM public.grainline_order_buyer_export_page(
              ${input.actorUserId}, ${PAGE_LIMIT},
              ${before?.createdAtEpochMillis ?? null}, ${before?.orderId ?? null}
            )
        `)
      : await input.client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
          SELECT *
            FROM public.grainline_order_seller_export_page(
              ${input.actorUserId}, ${PAGE_LIMIT},
              ${before?.createdAtEpochMillis ?? null}, ${before?.orderId ?? null}
            )
        `);
    const page = input.parse(rows, PAGE_LIMIT);
    for (const value of page.values) {
      const valueId = (value as { id: string }).id;
      if (ids.has(valueId)) throw new TypeError("Order export repeated an order id");
      ids.add(valueId);
      exported.push(value);
    }
    if (page.values.length < PAGE_LIMIT) return exported;
    if (
      page.cursor == null
      || (before != null
        && page.cursor.createdAtEpochMillis === before.createdAtEpochMillis
        && page.cursor.orderId === before.orderId)
    ) throw new TypeError("Order export cursor did not advance");
    before = page.cursor;
  }
}

export async function exportBuyerOrders(
  actorUserIdInput: string,
  client: OrderExportClient = prisma,
): Promise<BuyerOrderExport[]> {
  return exportPages({
    actorUserId: normalizeDbUserContextUserId(actorUserIdInput),
    participant: "buyer",
    client,
    parse: buyerOrderExportPageFromRows,
  });
}

export async function exportSellerOrders(
  actorUserIdInput: string,
  client: OrderExportClient = prisma,
): Promise<SellerOrderExport[]> {
  return exportPages({
    actorUserId: normalizeDbUserContextUserId(actorUserIdInput),
    participant: "seller",
    client,
    parse: sellerOrderExportPageFromRows,
  });
}
