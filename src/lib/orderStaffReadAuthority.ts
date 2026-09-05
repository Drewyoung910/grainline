import { Prisma } from "@prisma/client";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  staffOrderDetailFromRows,
  staffOrderPageFromRows,
} from "@/lib/orderStaffReadState";

export type StaffOrderReadClient = Pick<Prisma.TransactionClient, "$queryRaw">;
export type StaffOrderPageScope = "ALL" | "REVIEW_NEEDED";

const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;

function orderId(value: string) {
  if (typeof value !== "string" || !ORDER_ID_PATTERN.test(value)) {
    throw new TypeError("Staff Order id is invalid");
  }
  return value;
}

// Intentionally no default client: these functions must never run through the
// ordinary DATABASE_URL. The caller must supply a separately authenticated
// grainline_staff_read_runtime client after the credential boundary exists.
export async function readStaffOrderPage(
  actorUserIdInput: string,
  scope: StaffOrderPageScope,
  requestedPage: number,
  pageSize: number,
  client: StaffOrderReadClient,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  if (scope !== "ALL" && scope !== "REVIEW_NEEDED") {
    throw new TypeError("Staff Order page scope is invalid");
  }
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1 || requestedPage > 1000) {
    throw new TypeError("Staff Order requested page is invalid");
  }
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50) {
    throw new TypeError("Staff Order page size is invalid");
  }
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_staff_page_v2(
        ${actorUserId}, ${scope}, ${requestedPage}, ${pageSize}
      )
  `);
  return staffOrderPageFromRows(rows);
}

export async function readStaffOrderDetail(
  actorUserIdInput: string,
  orderIdInput: string,
  client: StaffOrderReadClient,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const normalizedOrderId = orderId(orderIdInput);
  const rows = await client.$queryRaw<Array<Record<string, unknown>>>(Prisma.sql`
    SELECT *
      FROM public.grainline_order_staff_detail_v2(${actorUserId}, ${normalizedOrderId})
  `);
  return staffOrderDetailFromRows(rows);
}
