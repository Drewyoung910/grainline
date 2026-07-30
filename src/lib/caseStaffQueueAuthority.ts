import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";
import {
  validateCaseStaffQueueResult,
  type CaseStaffQueueResult,
  type CaseStaffQueueRow,
} from "@/lib/caseStaffQueueResult";

type CaseStaffQueueClient = Pick<typeof prisma, "$queryRaw">;

function requireBoundedInteger(
  value: number,
  label: string,
  maximum: number,
) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new TypeError(`Case staff queue ${label} is invalid`);
  }
  return value;
}

const CASE_STATUSES = new Set<CaseStaffQueueRow["status"]>([
  "OPEN",
  "IN_DISCUSSION",
  "PENDING_CLOSE",
  "UNDER_REVIEW",
  "RESOLVED",
  "CLOSED",
]);

export async function getStaffCaseQueue(
  input: {
    actorUserId: string;
    statusFilter: CaseStaffQueueRow["status"] | null;
    requestedPage: number;
    pageSize: number;
  },
  db: CaseStaffQueueClient = prisma,
): Promise<CaseStaffQueueResult | null> {
  const actorUserId = normalizeDbUserContextUserId(input.actorUserId);
  const statusFilter = input.statusFilter;
  if (statusFilter !== null && !CASE_STATUSES.has(statusFilter)) {
    throw new TypeError("Case staff queue status filter is invalid");
  }
  const requestedPage = requireBoundedInteger(
    input.requestedPage,
    "requested page",
    1000,
  );
  const pageSize = requireBoundedInteger(input.pageSize, "page size", 50);
  const rows = await db.$queryRaw<unknown[]>`
    SELECT *
      FROM public.grainline_case_staff_queue(
        ${actorUserId}::text,
        ${statusFilter}::text,
        ${requestedPage}::integer,
        ${pageSize}::integer
      )
  `;
  if (rows.length === 0) return null;
  if (rows.length !== 1) {
    throw new TypeError(
      "Case staff queue authority returned an invalid row count",
    );
  }
  return validateCaseStaffQueueResult(rows[0], {
    requestedPage,
    pageSize,
    statusFilter,
  });
}
