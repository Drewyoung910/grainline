import { prisma } from "@/lib/db";
import { normalizeDbUserContextUserId } from "@/lib/dbUserContextState";

type StaffMutationClient = Pick<typeof prisma, "$queryRaw">;

const ORDER_ID_PATTERN = /^[A-Za-z0-9._:-]{1,191}$/;
const ORDER_NOTE_MAX_CHARS = 2_000;

function orderId(value: string) {
  if (!ORDER_ID_PATTERN.test(value)) {
    throw new TypeError("Staff Order mutation id is invalid");
  }
  return value;
}

function note(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > ORDER_NOTE_MAX_CHARS) {
    throw new TypeError("Staff Order note is invalid");
  }
  return normalized;
}

async function status(
  query: Promise<Array<{ status: unknown }>>,
  allowed: ReadonlySet<string>,
) {
  const rows = await query;
  if (
    rows.length !== 1
    || typeof rows[0]?.status !== "string"
    || !allowed.has(rows[0].status)
  ) {
    throw new TypeError("Staff Order mutation returned an invalid status");
  }
  return rows[0].status;
}

export function markStaffOrderReviewed(
  actorUserIdInput: string,
  orderIdInput: string,
  client: StaffMutationClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const normalizedOrderId = orderId(orderIdInput);
  return status(
    client.$queryRaw<Array<{ status: unknown }>>`
      SELECT public.grainline_order_staff_mark_reviewed(
        ${actorUserId}::text,
        ${normalizedOrderId}::text
      ) AS status
    `,
    new Set(["updated", "unchanged"]),
  );
}

export function recordStaffOrderLabelVoided(
  actorUserIdInput: string,
  orderIdInput: string,
  client: StaffMutationClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const normalizedOrderId = orderId(orderIdInput);
  return status(
    client.$queryRaw<Array<{ status: unknown }>>`
      SELECT public.grainline_order_staff_record_label_voided(
        ${actorUserId}::text,
        ${normalizedOrderId}::text
      ) AS status
    `,
    new Set([
      "updated",
      "missing",
      "not_purchased",
      "active_clawback",
      "too_long",
    ]),
  );
}

export function appendStaffOrderNote(
  actorUserIdInput: string,
  orderIdInput: string,
  noteInput: string,
  client: StaffMutationClient = prisma,
) {
  const actorUserId = normalizeDbUserContextUserId(actorUserIdInput);
  const normalizedOrderId = orderId(orderIdInput);
  const normalizedNote = note(noteInput);
  return status(
    client.$queryRaw<Array<{ status: unknown }>>`
      SELECT public.grainline_order_staff_append_note(
        ${actorUserId}::text,
        ${normalizedOrderId}::text,
        ${normalizedNote}::text
      ) AS status
    `,
    new Set(["updated", "missing", "too_long"]),
  );
}
