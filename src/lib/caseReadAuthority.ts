import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  validateCaseReadRow,
  validateCaseStaffActiveCount,
  type CaseReadRow,
} from "@/lib/caseReadResult";

type CaseReadClient = Pick<typeof prisma, "$queryRaw">;

function requireBoundedId(value: string, label: string) {
  if (!/^[A-Za-z0-9._:-]{1,191}$/.test(value)) {
    throw new TypeError(`Case read ${label} is invalid`);
  }
  return value;
}

async function normalizeSingleCaseRead(
  rows: unknown[],
  expected: {
    actorUserId: string;
    caseId?: string;
    orderId?: string;
  },
): Promise<CaseReadRow | null> {
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError("Case read authority returned an invalid row count");
  }
  return validateCaseReadRow(rows[0], expected);
}

export async function getVisibleCaseById(
  input: { actorUserId: string; caseId: string },
  db: CaseReadClient = prisma,
): Promise<CaseReadRow | null> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const caseId = requireBoundedId(input.caseId, "Case id");
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_get(
        ${actorUserId}::text,
        ${caseId}::text
      )
  `;
  return normalizeSingleCaseRead(rows, {
    actorUserId,
    caseId,
  });
}

export async function getVisibleCaseByOrderId(
  input: { actorUserId: string; orderId: string },
  db: CaseReadClient = prisma,
): Promise<CaseReadRow | null> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const orderId = requireBoundedId(input.orderId, "Order id");
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_get_by_order(
        ${actorUserId}::text,
        ${orderId}::text
      )
  `;
  return normalizeSingleCaseRead(rows, {
    actorUserId,
    orderId,
  });
}

export async function getStaffActiveCaseCount(
  actorUserIdInput: string,
  db: CaseReadClient = prisma,
): Promise<number | null> {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_staff_active_count(
        ${actorUserId}::text
      )
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError(
      "Case staff active-count authority returned an invalid row count",
    );
  }
  return validateCaseStaffActiveCount(rows[0]);
}
