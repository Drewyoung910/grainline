import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import { validateActiveCaseResult } from "@/lib/caseOrderActiveResult";

type CaseOrderActiveClient = Pick<typeof prisma, "$queryRaw">;

const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,128}$/;

function normalizeOrderId(orderId: string) {
  if (
    orderId !== orderId.trim()
    || !ORDER_ID_PATTERN.test(orderId)
  ) {
    throw new TypeError("Case-aware Order authority requires a bounded Order id");
  }
  return orderId;
}

export async function caseOrderActiveForBuyer(
  input: { actorUserId: string; orderId: string },
  db: CaseOrderActiveClient = prisma,
): Promise<boolean | null> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = normalizeOrderId(input.orderId);
  const rows = await db.$queryRaw<Array<{ active: unknown }>>`
    SELECT public.grainline_case_order_active_for_buyer(
      ${actorUserId}::text,
      ${orderId}::text
    ) AS active
  `;
  return validateActiveCaseResult(rows, "buyer");
}

export async function caseOrderActiveForSeller(
  input: { actorUserId: string; orderId: string },
  db: CaseOrderActiveClient = prisma,
): Promise<boolean | null> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = normalizeOrderId(input.orderId);
  const rows = await db.$queryRaw<Array<{ active: unknown }>>`
    SELECT public.grainline_case_order_active_for_seller(
      ${actorUserId}::text,
      ${orderId}::text
    ) AS active
  `;
  return validateActiveCaseResult(rows, "seller");
}
