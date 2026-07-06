import * as Sentry from "@sentry/nextjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { releaseCheckoutLock } from "@/lib/checkoutSessionLock";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import { parsePositiveInt } from "@/lib/stripeWebhookState";
import { stripe } from "@/lib/stripe";
import { checkoutStockReservationRepairAction } from "@/lib/checkoutStockReservationRepairState";

export const CHECKOUT_STOCK_RESERVATION_TTL_MS = 31 * 60 * 1000;
export const CHECKOUT_STOCK_RESERVATION_STALE_GRACE_MS = 2 * 60 * 60 * 1000;
export const CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE = 50;
export const CHECKOUT_STOCK_RESERVATION_TERMINAL_RETENTION_DAYS = 30;
export const CHECKOUT_STOCK_RESERVATION_TERMINAL_PRUNE_BATCH_SIZE = 100;

const CHECKOUT_STOCK_RESERVATION_RESTORABLE_STATUSES = ["RESERVED", "SESSION_CREATED"] as const;
type CheckoutStockReservationRestorableStatus =
  (typeof CHECKOUT_STOCK_RESERVATION_RESTORABLE_STATUSES)[number];
const CHECKOUT_STOCK_RESERVATION_TERMINAL_STATUSES = ["COMPLETED", "RESTORED"] as const;

export type CheckoutStockRestoreLineItem = {
  quantity?: number | null;
  price?: {
    unit_amount?: number | null;
    product?: { metadata?: Record<string, string> } | string | null;
  } | null;
};

export type RestorableStockItem = { listingId: string; quantity: number };
export type CheckoutStockReservationItem = RestorableStockItem & {
  sellerId: string;
  title?: string;
};

export class CheckoutStockReservationStockError extends Error {
  constructor(readonly listingId: string) {
    super("Checkout stock reservation failed because stock was no longer available.");
    this.name = "CheckoutStockReservationStockError";
  }
}

export async function lockCheckoutSessionMutation(tx: Prisma.TransactionClient, sessionId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(913337, hashtext(${sessionId}))`;
}

function isPrismaUniqueViolation(error: unknown) {
  return Boolean(
    error &&
    typeof error === "object" &&
    "code" in error &&
    (error as { code?: string }).code === "P2002",
  );
}

function mergeRestorableStockItems(items: RestorableStockItem[]) {
  const merged = new Map<string, number>();
  for (const item of items) {
    if (!item.listingId || item.quantity <= 0) continue;
    merged.set(item.listingId, (merged.get(item.listingId) ?? 0) + item.quantity);
  }
  return [...merged.entries()].map(([listingId, quantity]) => ({ listingId, quantity }));
}

function mergeCheckoutStockReservationItems(items: CheckoutStockReservationItem[]) {
  const merged = new Map<string, CheckoutStockReservationItem>();
  for (const item of items) {
    if (!item.listingId || !item.sellerId || item.quantity <= 0) continue;
    const existing = merged.get(item.listingId);
    if (existing) {
      existing.quantity += item.quantity;
      continue;
    }
    merged.set(item.listingId, { ...item });
  }
  return [...merged.values()];
}

export function checkoutStockReservationExpiresAt(now = new Date()) {
  return new Date(now.getTime() + CHECKOUT_STOCK_RESERVATION_TTL_MS);
}

export function checkoutStockReservationMetadata(
  reservationId: string | null | undefined,
  checkoutGroupId?: string | null,
): Record<string, string> {
  return {
    ...(reservationId ? { checkoutReservationId: reservationId } : {}),
    ...(checkoutGroupId ? { checkoutGroupId } : {}),
  };
}

export function checkoutStockReservationStaleCutoff(now = new Date()) {
  return new Date(now.getTime() - CHECKOUT_STOCK_RESERVATION_STALE_GRACE_MS);
}

export function checkoutStockReservationTerminalRetentionCutoff({
  now = new Date(),
  retentionDays = CHECKOUT_STOCK_RESERVATION_TERMINAL_RETENTION_DAYS,
}: {
  now?: Date;
  retentionDays?: number;
} = {}) {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export function parseCheckoutStockReservationItems(value: unknown): RestorableStockItem[] {
  if (!Array.isArray(value)) return [];
  return mergeRestorableStockItems(
    value.flatMap((item) => {
      if (!item || typeof item !== "object") return [];
      const candidate = item as { listingId?: unknown; quantity?: unknown };
      const listingId = typeof candidate.listingId === "string" ? candidate.listingId : "";
      const quantityValue = typeof candidate.quantity === "string" || typeof candidate.quantity === "number"
        ? candidate.quantity
        : undefined;
      const quantity = parsePositiveInt(quantityValue, 0);
      return listingId && quantity > 0 ? [{ listingId, quantity }] : [];
    }),
  );
}

export async function createCheckoutStockReservation(input: {
  checkoutLockKey: string;
  checkoutGroupId?: string | null;
  payloadHash: string;
  buyerId: string;
  sellerId?: string | null;
  items: CheckoutStockReservationItem[];
  now?: Date;
}) {
  const reservedItems = mergeCheckoutStockReservationItems(input.items);
  if (reservedItems.length === 0) return null;

  const expiresAt = checkoutStockReservationExpiresAt(input.now ?? new Date());
  return prisma.$transaction(async (tx) => {
    const reservation = await tx.checkoutStockReservation.create({
      data: {
        checkoutLockKey: input.checkoutLockKey,
        checkoutGroupId: input.checkoutGroupId ?? null,
        payloadHash: input.payloadHash,
        buyerId: input.buyerId,
        sellerId: input.sellerId ?? null,
        reservedItems: reservedItems.map(({ listingId, sellerId, quantity }) => ({
          listingId,
          sellerId,
          quantity,
        })) as Prisma.InputJsonValue,
        expiresAt,
      },
      select: { id: true },
    });

    for (const item of reservedItems) {
      const reserved: number = await tx.$executeRaw`
        UPDATE "Listing"
        SET "stockQuantity" = "stockQuantity" - ${item.quantity}
        WHERE id = ${item.listingId}
          AND "sellerId" = ${item.sellerId}
          AND status = 'ACTIVE'
          AND "listingType" = 'IN_STOCK'
          AND "stockQuantity" >= ${item.quantity}
      `;
      if (Number(reserved) !== 1) {
        throw new CheckoutStockReservationStockError(item.listingId);
      }
    }

    return { id: reservation.id, reservedItems, expiresAt };
  });
}

export async function markCheckoutStockReservationSession(input: {
  reservationId?: string | null;
  payloadHash: string;
  sessionId: string;
}) {
  if (!input.reservationId) return false;
  const updated = await prisma.checkoutStockReservation.updateMany({
    where: {
      id: input.reservationId,
      payloadHash: input.payloadHash,
      status: "RESERVED",
    },
    data: {
      status: "SESSION_CREATED",
      stripeSessionId: input.sessionId,
    },
  });
  return updated.count === 1;
}

export async function markCheckoutStockReservationCompleted(
  tx: Prisma.TransactionClient,
  input: { reservationId?: string | null; sessionId: string },
) {
  const clauses = [
    input.reservationId ? { id: input.reservationId } : null,
    input.sessionId ? { stripeSessionId: input.sessionId } : null,
  ].filter((clause): clause is { id: string } | { stripeSessionId: string } => clause !== null);
  if (clauses.length === 0) return 0;
  const updated = await tx.checkoutStockReservation.updateMany({
    where: {
      OR: clauses,
      status: { in: [...CHECKOUT_STOCK_RESERVATION_RESTORABLE_STATUSES] },
    },
    data: {
      status: "COMPLETED",
      stripeSessionId: input.sessionId,
    },
  });
  return updated.count;
}

export function restorableStockItemsFromLineItems(lineItems: CheckoutStockRestoreLineItem[]) {
  return mergeRestorableStockItems(
    lineItems.flatMap((lineItem) => {
      const product = typeof lineItem.price?.product === "object" ? lineItem.price.product : null;
      const listingId = product?.metadata?.listingId;
      const quantity = parsePositiveInt(lineItem.quantity, 0);
      return listingId && quantity > 0 ? [{ listingId, quantity }] : [];
    }),
  );
}

function restorableStockItemsFromMetadata(metadata: Record<string, string | undefined>) {
  const items: RestorableStockItem[] = [];
  const singleListingId = metadata.listingId;
  const singleQuantity = parsePositiveInt(metadata.quantity, 0);
  if (singleListingId && singleQuantity > 0) {
    items.push({ listingId: singleListingId, quantity: singleQuantity });
  }

  for (const token of (metadata.reservedStock ?? "").split(",")) {
    const [listingId, quantityValue] = token.split(":");
    const quantity = parsePositiveInt(quantityValue, 0);
    if (listingId && quantity > 0) items.push({ listingId, quantity });
  }

  return mergeRestorableStockItems(items);
}

export async function restoreReservedStockItems(tx: Prisma.TransactionClient, items: RestorableStockItem[]) {
  let stockStatusRestoredCount = 0;
  for (const item of mergeRestorableStockItems(items)) {
    await tx.$executeRaw`
      UPDATE "Listing"
      SET "stockQuantity" = "stockQuantity" + ${item.quantity}
      WHERE id = ${item.listingId}
        AND "listingType" = 'IN_STOCK'
    `;
    const stockStatusUpdate = await tx.listing.updateMany({
      where: { id: item.listingId, status: "SOLD_OUT", stockQuantity: { gt: 0 } },
      data: { status: "ACTIVE" },
    });
    stockStatusRestoredCount += stockStatusUpdate.count;
  }
  return stockStatusRestoredCount;
}

async function lockCheckoutStockReservationMutation(tx: Prisma.TransactionClient, reservationKey: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(913338, hashtext(${reservationKey}))`;
}

function checkoutStockReservationLookup(input: { reservationId?: string | null; sessionId?: string | null }) {
  return [
    input.reservationId ? { id: input.reservationId } : null,
    input.sessionId ? { stripeSessionId: input.sessionId } : null,
  ].filter((clause): clause is { id: string } | { stripeSessionId: string } => clause !== null);
}

export async function restoreCheckoutStockReservationOnce(input: {
  reservationId?: string | null;
  sessionId?: string | null;
  reason: string;
  releaseLock?: boolean;
}) {
  const clauses = checkoutStockReservationLookup(input);
  if (clauses.length === 0) {
    return { handled: false, restored: false, stockStatusRestoredCount: 0 };
  }

  const result = await prisma.$transaction(async (tx) => {
    await lockCheckoutStockReservationMutation(tx, input.reservationId ?? input.sessionId ?? "unknown");

    const reservation = await tx.checkoutStockReservation.findFirst({
      where: { OR: clauses },
      select: {
        id: true,
        checkoutLockKey: true,
        stripeSessionId: true,
        status: true,
        reservedItems: true,
      },
    });

    if (!reservation) {
      return { handled: false, restored: false, stockStatusRestoredCount: 0 };
    }

    const sessionIds = [...new Set([input.sessionId, reservation.stripeSessionId].filter(Boolean))] as string[];
    if (sessionIds.length > 0) {
      for (const sessionId of [...sessionIds].sort()) {
        await lockCheckoutSessionMutation(tx, sessionId);
      }

      const orderExists = await tx.order.findFirst({
        where: { stripeSessionId: { in: sessionIds } },
        select: { id: true },
      });
      if (orderExists) {
        await tx.checkoutStockReservation.updateMany({
          where: { id: reservation.id, status: { in: [...CHECKOUT_STOCK_RESERVATION_RESTORABLE_STATUSES] } },
          data: { status: "COMPLETED", stripeSessionId: sessionIds[0] },
        });
        return {
          handled: true,
          restored: false,
          stockStatusRestoredCount: 0,
          checkoutLockKey: reservation.checkoutLockKey,
          sessionId: sessionIds[0],
        };
      }
    }

    if (reservation.status === "COMPLETED" || reservation.status === "RESTORED") {
      return {
        handled: true,
        restored: false,
        stockStatusRestoredCount: 0,
        checkoutLockKey: reservation.checkoutLockKey,
        sessionId: input.sessionId ?? reservation.stripeSessionId,
      };
    }

    if (!CHECKOUT_STOCK_RESERVATION_RESTORABLE_STATUSES.includes(reservation.status as CheckoutStockReservationRestorableStatus)) {
      return { handled: false, restored: false, stockStatusRestoredCount: 0 };
    }

    const items = parseCheckoutStockReservationItems(reservation.reservedItems);
    if (items.length === 0) {
      Sentry.captureMessage("Checkout stock reservation had no restorable items", {
        level: "warning",
        tags: { source: "checkout_stock_reservation_restore" },
        extra: {
          reservationId: reservation.id,
          stripeSessionId: input.sessionId ?? reservation.stripeSessionId,
          status: reservation.status,
        },
      });
      return { handled: false, restored: false, stockStatusRestoredCount: 0 };
    }

    const restoredAt = new Date();
    const claimed = await tx.checkoutStockReservation.updateMany({
      where: {
        id: reservation.id,
        status: { in: [...CHECKOUT_STOCK_RESERVATION_RESTORABLE_STATUSES] },
      },
      data: {
        status: "RESTORED",
        restoredAt,
        restoreReason: input.reason,
        ...(input.sessionId && !reservation.stripeSessionId ? { stripeSessionId: input.sessionId } : {}),
      },
    });
    if (claimed.count !== 1) {
      return {
        handled: true,
        restored: false,
        stockStatusRestoredCount: 0,
        checkoutLockKey: reservation.checkoutLockKey,
        sessionId: input.sessionId ?? reservation.stripeSessionId,
      };
    }

    const stockStatusRestoredCount = await restoreReservedStockItems(tx, items);
    return {
      handled: true,
      restored: true,
      stockStatusRestoredCount,
      checkoutLockKey: reservation.checkoutLockKey,
      sessionId: input.sessionId ?? reservation.stripeSessionId,
    };
  });

  if (input.releaseLock !== false && "checkoutLockKey" in result) {
    await releaseCheckoutLock(result.checkoutLockKey, result.sessionId);
  }

  if (result.stockStatusRestoredCount > 0) {
    revalidateListingSearchCaches();
    revalidateFeaturedMakerCaches();
  }

  return result;
}

async function deferCheckoutStockReservationRepair(
  reservationId: string,
  reason: string,
  now: Date,
) {
  try {
    await prisma.checkoutStockReservation.updateMany({
      where: {
        id: reservationId,
        status: { in: [...CHECKOUT_STOCK_RESERVATION_RESTORABLE_STATUSES] },
      },
      data: {
        expiresAt: now,
        restoreReason: reason,
      },
    });
  } catch (error) {
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "checkout_stock_reservation_repair_defer" },
      extra: { reservationId, reason },
    });
  }
}

export async function restoreStaleCheckoutStockReservations(input: {
  now?: Date;
  take?: number;
  graceMs?: number;
} = {}) {
  const now = input.now ?? new Date();
  const graceMs = input.graceMs ?? CHECKOUT_STOCK_RESERVATION_STALE_GRACE_MS;
  const cutoff = new Date(now.getTime() - graceMs);
  const take = input.take ?? CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE;
  const staleReservations = await prisma.checkoutStockReservation.findMany({
    where: {
      OR: [
        { status: "RESERVED", stripeSessionId: null },
        { status: "SESSION_CREATED", stripeSessionId: { not: null } },
      ],
      expiresAt: { lt: cutoff },
    },
    orderBy: { expiresAt: "asc" },
    take,
    select: { id: true, stripeSessionId: true },
  });

  let restored = 0;
  let skipped = 0;
  const errors: Array<{ reservationId: string; code: string }> = [];

  for (const reservation of staleReservations) {
    try {
      let reason = "stale_no_session";
      if (reservation.stripeSessionId) {
        const orderExists = await prisma.order.findFirst({
          where: { stripeSessionId: reservation.stripeSessionId },
          select: { id: true },
        });
        if (orderExists) {
          const result = await restoreCheckoutStockReservationOnce({
            reservationId: reservation.id,
            sessionId: reservation.stripeSessionId,
            reason: "stale_session_order_exists",
          });
          if (result.restored) restored += 1;
          else skipped += 1;
          continue;
        }

        let session: { status?: string | null; payment_status?: string | null };
        try {
          session = await stripe.checkout.sessions.retrieve(reservation.stripeSessionId);
        } catch (error) {
          const err = error as { code?: string; name?: string };
          errors.push({ reservationId: reservation.id, code: err.code ?? err.name ?? "SESSION_RETRIEVE_FAILED" });
          Sentry.captureException(error, {
            tags: { source: "checkout_stock_reservation_stale_session_retrieve" },
            extra: { reservationId: reservation.id, stripeSessionId: reservation.stripeSessionId },
          });
          await deferCheckoutStockReservationRepair(reservation.id, "session_retrieve_failed", now);
          continue;
        }

        const action = checkoutStockReservationRepairAction(session);
        if (action === "skip_paid_or_complete") {
          skipped += 1;
          Sentry.captureMessage("Paid checkout session missing local order during stock reservation repair", {
            level: "warning",
            tags: { source: "checkout_stock_reservation_paid_missing_order" },
            extra: {
              reservationId: reservation.id,
              stripeSessionId: reservation.stripeSessionId,
              sessionStatus: session.status,
              paymentStatus: session.payment_status,
            },
          });
          await deferCheckoutStockReservationRepair(reservation.id, "paid_missing_local_order", now);
          continue;
        }
        if (action === "skip_unrecognized") {
          skipped += 1;
          Sentry.captureMessage("Checkout stock reservation repair skipped unrecognized Stripe session state", {
            level: "warning",
            tags: { source: "checkout_stock_reservation_unrecognized_session_state" },
            extra: {
              reservationId: reservation.id,
              stripeSessionId: reservation.stripeSessionId,
              sessionStatus: session.status,
              paymentStatus: session.payment_status,
            },
          });
          await deferCheckoutStockReservationRepair(reservation.id, "unrecognized_session_state", now);
          continue;
        }
        if (action === "expire_and_restore") {
          try {
            await stripe.checkout.sessions.expire(reservation.stripeSessionId);
          } catch (error) {
            const err = error as { code?: string; name?: string };
            errors.push({ reservationId: reservation.id, code: err.code ?? err.name ?? "SESSION_EXPIRE_FAILED" });
            Sentry.captureException(error, {
              tags: { source: "checkout_stock_reservation_stale_session_expire" },
              extra: { reservationId: reservation.id, stripeSessionId: reservation.stripeSessionId },
            });
            await deferCheckoutStockReservationRepair(reservation.id, "session_expire_failed", now);
            continue;
          }
        }
        reason = "stale_stripe_session_unpaid";
      }
      const result = await restoreCheckoutStockReservationOnce({
        reservationId: reservation.id,
        sessionId: reservation.stripeSessionId,
        reason,
      });
      if (result.restored) restored += 1;
      else skipped += 1;
    } catch (error) {
      const err = error as { code?: string; name?: string };
      errors.push({ reservationId: reservation.id, code: err.code ?? err.name ?? "UNKNOWN" });
      Sentry.captureException(error, {
        tags: { source: "checkout_stock_reservation_stale_restore" },
        extra: { reservationId: reservation.id },
      });
      await deferCheckoutStockReservationRepair(reservation.id, "stale_restore_failed", now);
    }
  }

  return {
    scanned: staleReservations.length,
    restored,
    skipped,
    errors,
    hasMore: staleReservations.length === take,
  };
}

export async function pruneTerminalCheckoutStockReservations(input: {
  now?: Date;
  take?: number;
  retentionDays?: number;
} = {}) {
  const cutoff = checkoutStockReservationTerminalRetentionCutoff({
    now: input.now ?? new Date(),
    retentionDays: input.retentionDays,
  });
  const take = input.take ?? CHECKOUT_STOCK_RESERVATION_TERMINAL_PRUNE_BATCH_SIZE;
  const terminalRows = await prisma.checkoutStockReservation.findMany({
    where: {
      status: { in: [...CHECKOUT_STOCK_RESERVATION_TERMINAL_STATUSES] },
      updatedAt: { lt: cutoff },
    },
    orderBy: { updatedAt: "asc" },
    take,
    select: { id: true },
  });
  if (terminalRows.length === 0) {
    return { pruned: 0, cutoff: cutoff.toISOString() };
  }

  const deleted = await prisma.checkoutStockReservation.deleteMany({
    where: {
      id: { in: terminalRows.map((row) => row.id) },
      status: { in: [...CHECKOUT_STOCK_RESERVATION_TERMINAL_STATUSES] },
    },
  });
  return { pruned: deleted.count, cutoff: cutoff.toISOString() };
}

async function claimCheckoutStockRestore(tx: Prisma.TransactionClient, sessionId: string) {
  try {
    await tx.stripeWebhookEvent.create({
      data: {
        id: `checkout-stock-restore:${sessionId}`,
        type: "checkout.session.stock_restored",
        processingStartedAt: new Date(),
        processedAt: new Date(),
      },
    });
    return true;
  } catch (error) {
    if (isPrismaUniqueViolation(error)) return false;
    throw error;
  }
}

export async function restoreUnorderedCheckoutStockOnce(input: {
  sessionId: string;
  metadata: Record<string, string | undefined>;
  lineItems?: CheckoutStockRestoreLineItem[];
}) {
  const reservationRestore = await restoreCheckoutStockReservationOnce({
    reservationId: input.metadata.checkoutReservationId,
    sessionId: input.sessionId,
    reason: "stripe_session_unpaid",
  });
  if (reservationRestore.handled) return;

  const stockStatusRestoredCount = await prisma.$transaction(async (tx) => {
    await lockCheckoutSessionMutation(tx, input.sessionId);

    const orderExists = await tx.order.findFirst({
      where: { stripeSessionId: input.sessionId },
      select: { id: true },
    });
    if (orderExists) return 0;

    let items = restorableStockItemsFromLineItems(input.lineItems ?? []);
    if (items.length === 0) {
      items = restorableStockItemsFromMetadata(input.metadata);
    }

    if (items.length === 0 && input.metadata.cartId && input.metadata.sellerId) {
      const cartItems = await tx.cartItem.findMany({
        where: { cartId: input.metadata.cartId, listing: { sellerId: input.metadata.sellerId } },
        select: { listingId: true, quantity: true },
      });
      items = mergeRestorableStockItems(cartItems);
    }

    if (items.length === 0) {
      Sentry.captureMessage("Checkout stock restoration skipped because no reserved items were recoverable", {
        level: "warning",
        tags: { source: "checkout_stock_restore" },
        extra: {
          stripeSessionId: input.sessionId,
          cartId: input.metadata.cartId,
          sellerId: input.metadata.sellerId,
          listingId: input.metadata.listingId,
        },
      });
      return 0;
    }

    const claimed = await claimCheckoutStockRestore(tx, input.sessionId);
    if (!claimed) return 0;

    return restoreReservedStockItems(tx, items);
  });

  await releaseCheckoutLock(input.metadata.checkoutLockKey, input.sessionId);

  if (stockStatusRestoredCount > 0) {
    revalidateListingSearchCaches();
    revalidateFeaturedMakerCaches();
  }
}
