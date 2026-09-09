import { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";

export const SELLER_REFUND_PREFLIGHT_DECISIONS = [
  "READY",
  "FORBIDDEN",
  "NOT_FOUND",
  "OPEN_DISPUTE",
  "PROCESSING",
  "AMBIGUOUS",
  "RECORDED",
  "LABEL_BLOCKED",
  "NO_PAYMENT",
  "STATE_CHANGED",
] as const;

export type SellerRefundPreflightDecision =
  (typeof SELLER_REFUND_PREFLIGHT_DECISIONS)[number];

type SellerRefundPreflightClient = Pick<Prisma.TransactionClient, "$queryRaw">;
const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

export async function sellerRefundPreflight(
  input: { actorUserId: string; orderId: string },
  client: SellerRefundPreflightClient = prisma,
): Promise<SellerRefundPreflightDecision> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  if (!ORDER_ID_PATTERN.test(input.orderId)) {
    throw new TypeError("Seller refund preflight order id is invalid");
  }
  const rows = await client.$queryRaw<Array<{ decision: unknown }>>(Prisma.sql`
    SELECT public.grainline_seller_refund_preflight(
      ${actorUserId}::text,
      ${input.orderId}::text
    ) AS decision
  `);
  if (rows.length !== 1) {
    throw new TypeError("Seller refund preflight returned an invalid row count");
  }
  const decision = rows[0]?.decision;
  if (
    typeof decision !== "string"
    || !(SELLER_REFUND_PREFLIGHT_DECISIONS as readonly string[]).includes(decision)
  ) {
    throw new TypeError("Seller refund preflight returned an invalid decision");
  }
  return decision as SellerRefundPreflightDecision;
}
