import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import { orderCheckoutReceiptsFromRows } from "@/lib/orderCheckoutReceiptState";

type OrderCheckoutReceiptClient = Pick<Prisma.TransactionClient, "$queryRaw">;
const CHECKOUT_SESSION_ID_PATTERN = /^cs_.{1,252}$/;

function normalizedSessionIds(values: readonly string[]) {
  if (
    values.length < 1
    || values.length > 50
    || new Set(values).size !== values.length
    || values.some((value) => (
      typeof value !== "string"
      || !CHECKOUT_SESSION_ID_PATTERN.test(value)
      || value.trim() !== value
    ))
  ) {
    throw new TypeError("Checkout receipt session ids are invalid");
  }
  return [...values];
}

export async function readBuyerCheckoutReceipts(
  actorUserIdInput: string,
  sessionIdInputs: readonly string[],
  client: OrderCheckoutReceiptClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const sessionIds = normalizedSessionIds(sessionIdInputs);
  const sessionIdsSql = Prisma.sql`ARRAY[${Prisma.join(sessionIds)}]::text[]`;
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT order_id, created_at_epoch_millis, paid_at_epoch_millis,
           currency, items_subtotal_cents, shipping_title,
           shipping_amount_cents, tax_amount_cents,
           gift_wrapping_price_cents, buyer_label, items
      FROM public.grainline_order_buyer_receipts_by_sessions(
        ${actorUserId},
        ${sessionIdsSql}
      )
  `);
  return orderCheckoutReceiptsFromRows(rows);
}
