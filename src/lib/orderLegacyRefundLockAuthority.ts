import { prisma } from "@/lib/db";

type LegacyRefundLockClient = Pick<typeof prisma, "$queryRaw">;

function requireBoolean(value: unknown, label: string) {
  if (typeof value !== "boolean") {
    throw new TypeError(`${label} returned an invalid result`);
  }
  return value;
}

function requireCount(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0 || Number(value) > 100) {
    throw new TypeError("Order legacy refund-lock prune returned an invalid count");
  }
  return Number(value);
}

export async function releaseBlockedCheckoutLegacyRefundLock(
  input: {
    eventId: string;
    eventClaimGeneration: bigint;
    sessionId: string;
    orderId: string;
  },
  db: LegacyRefundLockClient = prisma,
) {
  const rows = await db.$queryRaw<Array<{ released: unknown }>>`
    SELECT public.grainline_blocked_checkout_legacy_refund_lock_release(
      ${input.eventId}::text,
      ${input.eventClaimGeneration}::bigint,
      ${input.sessionId}::text,
      ${input.orderId}::text
    ) AS released
  `;
  if (rows.length !== 1) {
    throw new TypeError("Blocked-checkout legacy refund-lock release returned an invalid row count");
  }
  return requireBoolean(
    rows[0].released,
    "Blocked-checkout legacy refund-lock release",
  );
}

export async function releaseCaseLegacyRefundLock(
  input: { actorUserId: string; caseId: string },
  db: LegacyRefundLockClient = prisma,
) {
  const rows = await db.$queryRaw<Array<{ released: unknown }>>`
    SELECT public.grainline_case_legacy_refund_lock_release(
      ${input.actorUserId}::text,
      ${input.caseId}::text
    ) AS released
  `;
  if (rows.length !== 1) {
    throw new TypeError("Case legacy refund-lock release returned an invalid row count");
  }
  return requireBoolean(rows[0].released, "Case legacy refund-lock release");
}

export async function pruneLegacyRefundLocks(
  batchSize = 100,
  db: LegacyRefundLockClient = prisma,
) {
  const rows = await db.$queryRaw<Array<{ released_count: unknown }>>`
    SELECT public.grainline_order_legacy_refund_lock_prune(
      ${batchSize}::integer
    ) AS released_count
  `;
  if (rows.length !== 1) {
    throw new TypeError("Order legacy refund-lock prune returned an invalid row count");
  }
  return { count: requireCount(rows[0].released_count) };
}
