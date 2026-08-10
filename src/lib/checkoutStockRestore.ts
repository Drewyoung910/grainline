import * as Sentry from "@sentry/nextjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { releaseCheckoutLock } from "@/lib/checkoutSessionLock";
import { revalidateFeaturedMakerCaches, revalidateListingSearchCaches } from "@/lib/searchCache";
import { parsePositiveInt } from "@/lib/stripeWebhookState";
import { stripe } from "@/lib/stripe";
import { checkoutStockReservationRepairAction } from "@/lib/checkoutStockReservationRepairState";
import { claimLegacyStockRestore } from "@/lib/stripeWebhookMaintenance";
import {
  claimStaleCheckoutStockReservations,
  completeCheckoutStockReservation,
  finalizeCheckoutStockReservationRepair,
  pruneCheckoutStockReservationBatch,
  restoreBuyerExpiredCheckoutStockReservation,
  restoreCheckoutStockReservationFromWebhook,
  restoreSellerExpiredCheckoutStockReservation,
  type CheckoutReservationTransition,
} from "@/lib/checkoutStockReservationAuthority";

export const CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE = 50;
export const CHECKOUT_STOCK_RESERVATION_TERMINAL_RETENTION_DAYS = 30;
export const CHECKOUT_STOCK_RESERVATION_TERMINAL_PRUNE_BATCH_SIZE = 100;

export type CheckoutStockRestoreLineItem = {
  quantity?: number | null;
  price?: {
    unit_amount?: number | null;
    product?: { metadata?: Record<string, string> } | string | null;
  } | null;
};

type RestorableStockItem = { listingId: string; quantity: number };

export async function lockCheckoutSessionMutation(tx: Prisma.TransactionClient, sessionId: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(913337, hashtext(${sessionId}))`;
}

function mergeRestorableStockItems(items: RestorableStockItem[]) {
  const merged = new Map<string, number>();
  for (const item of items) {
    if (!item.listingId || item.quantity <= 0) continue;
    merged.set(item.listingId, (merged.get(item.listingId) ?? 0) + item.quantity);
  }
  return [...merged.entries()].map(([listingId, quantity]) => ({ listingId, quantity }));
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

export function checkoutStockReservationTerminalRetentionCutoff({
  now = new Date(),
  retentionDays = CHECKOUT_STOCK_RESERVATION_TERMINAL_RETENTION_DAYS,
}: {
  now?: Date;
  retentionDays?: number;
} = {}) {
  return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export async function markCheckoutStockReservationCompleted(
  tx: Prisma.TransactionClient,
  input: {
    eventId: string;
    claimGeneration: bigint;
    reservationId?: string | null;
    sessionId: string;
  },
) {
  return completeCheckoutStockReservation(tx, input);
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

export async function restoreStaleCheckoutStockReservations(input: {
  now?: Date;
  take?: number;
  graceMs?: number;
} = {}) {
  const take = input.take ?? CHECKOUT_STOCK_RESERVATION_STALE_BATCH_SIZE;
  const staleReservations = await claimStaleCheckoutStockReservations(take);

  let restored = 0;
  let skipped = 0;
  const errors: Array<{ reservationId: string; code: string }> = [];

  for (const reservation of staleReservations) {
    try {
      let outcome: Parameters<typeof finalizeCheckoutStockReservationRepair>[0]["outcome"] =
        "NO_SESSION_RESTORE";
      if (reservation.stripeSessionId) {
        let session: { status?: string | null; payment_status?: string | null };
        try {
          session = await stripe.checkout.sessions.retrieve(reservation.stripeSessionId);
        } catch (error) {
          const err = error as { code?: string; name?: string };
          errors.push({
            reservationId: reservation.reservationId,
            code: err.code ?? err.name ?? "SESSION_RETRIEVE_FAILED",
          });
          Sentry.captureException(error, {
            tags: { source: "checkout_stock_reservation_stale_session_retrieve" },
            extra: {
              reservationId: reservation.reservationId,
              stripeSessionId: reservation.stripeSessionId,
            },
          });
          outcome = "RETRIEVE_FAILED";
          const result = await finalizeCheckoutStockReservationRepair({
            reservationId: reservation.reservationId,
            repairGeneration: reservation.repairGeneration,
            outcome,
          });
          if (result.result === "restored") restored += 1;
          else skipped += 1;
          continue;
        }

        const action = checkoutStockReservationRepairAction(session);
        if (action === "skip_paid_or_complete") {
          Sentry.captureMessage("Paid checkout session missing local order during stock reservation repair", {
            level: "warning",
            tags: { source: "checkout_stock_reservation_paid_missing_order" },
            extra: {
              reservationId: reservation.reservationId,
              stripeSessionId: reservation.stripeSessionId,
              sessionStatus: session.status,
              paymentStatus: session.payment_status,
            },
          });
          outcome = "PAID_OR_COMPLETE";
        } else if (action === "skip_unrecognized") {
          Sentry.captureMessage("Checkout stock reservation repair skipped unrecognized Stripe session state", {
            level: "warning",
            tags: { source: "checkout_stock_reservation_unrecognized_session_state" },
            extra: {
              reservationId: reservation.reservationId,
              stripeSessionId: reservation.stripeSessionId,
              sessionStatus: session.status,
              paymentStatus: session.payment_status,
            },
          });
          outcome = "UNRECOGNIZED";
        } else if (action === "expire_and_restore") {
          try {
            await stripe.checkout.sessions.expire(reservation.stripeSessionId);
            outcome = "SESSION_EXPIRED_RESTORE";
          } catch (error) {
            const err = error as { code?: string; name?: string };
            errors.push({
              reservationId: reservation.reservationId,
              code: err.code ?? err.name ?? "SESSION_EXPIRE_FAILED",
            });
            Sentry.captureException(error, {
              tags: { source: "checkout_stock_reservation_stale_session_expire" },
              extra: {
                reservationId: reservation.reservationId,
                stripeSessionId: reservation.stripeSessionId,
              },
            });
            outcome = "EXPIRE_FAILED";
          }
        } else {
          outcome = "SESSION_EXPIRED_RESTORE";
        }
      }

      const result = await finalizeCheckoutStockReservationRepair({
        reservationId: reservation.reservationId,
        repairGeneration: reservation.repairGeneration,
        outcome,
      });
      if (result.result === "restored") restored += 1;
      else skipped += 1;
      if (
        result.checkoutLockKey &&
        result.stripeSessionId &&
        (result.result === "restored" || result.result === "completed" || result.result === "terminal")
      ) {
        await releaseCheckoutLock(result.checkoutLockKey, result.stripeSessionId);
      }
      if (result.stockVisibilityChanged > 0) {
        revalidateListingSearchCaches();
        revalidateFeaturedMakerCaches();
      }
    } catch (error) {
      const err = error as { code?: string; name?: string };
      errors.push({
        reservationId: reservation.reservationId,
        code: err.code ?? err.name ?? "UNKNOWN",
      });
      Sentry.captureException(error, {
        tags: { source: "checkout_stock_reservation_stale_restore" },
        extra: {
          reservationId: reservation.reservationId,
          repairGeneration: reservation.repairGeneration.toString(),
        },
      });
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
  const pruned = await pruneCheckoutStockReservationBatch(take);
  return { pruned, cutoff: cutoff.toISOString() };
}

async function claimCheckoutStockRestore(tx: Prisma.TransactionClient, sessionId: string) {
  return claimLegacyStockRestore(sessionId, tx);
}

async function handleFixedReservationTransition(
  transition: CheckoutReservationTransition,
  sessionId: string,
) {
  if (transition.result === "absent") return false;
  if (transition.checkoutLockKey) {
    await releaseCheckoutLock(transition.checkoutLockKey, sessionId);
  }
  if (transition.stockVisibilityChanged > 0) {
    revalidateListingSearchCaches();
    revalidateFeaturedMakerCaches();
  }
  return true;
}

async function restoreLegacyUnorderedCheckoutStockOnce(input: {
  sessionId: string;
  metadata: Record<string, string | undefined>;
  lineItems?: CheckoutStockRestoreLineItem[];
}) {
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

export async function restoreUnorderedCheckoutStockOnce(input: {
  eventId: string;
  claimGeneration: bigint;
  sessionId: string;
  metadata: Record<string, string | undefined>;
  lineItems?: CheckoutStockRestoreLineItem[];
}) {
  const reservationRestore = await restoreCheckoutStockReservationFromWebhook({
    eventId: input.eventId,
    claimGeneration: input.claimGeneration,
    sessionId: input.sessionId,
  });
  if (await handleFixedReservationTransition(reservationRestore, input.sessionId)) return;
  await restoreLegacyUnorderedCheckoutStockOnce(input);
}

export async function restoreBuyerExpiredCheckoutStockOnce(input: {
  buyerId: string;
  sessionId: string;
  metadata: Record<string, string | undefined>;
  lineItems?: CheckoutStockRestoreLineItem[];
}) {
  const transition = await restoreBuyerExpiredCheckoutStockReservation({
    buyerId: input.buyerId,
    sessionId: input.sessionId,
  });
  if (await handleFixedReservationTransition(transition, input.sessionId)) return;
  await restoreLegacyUnorderedCheckoutStockOnce(input);
}

export async function restoreSellerExpiredCheckoutStockOnce(input: {
  sellerProfileId: string;
  sessionId: string;
  metadata: Record<string, string | undefined>;
  lineItems?: CheckoutStockRestoreLineItem[];
}) {
  const transition = await restoreSellerExpiredCheckoutStockReservation({
    sellerProfileId: input.sellerProfileId,
    sessionId: input.sessionId,
  });
  if (await handleFixedReservationTransition(transition, input.sessionId)) return;
  await restoreLegacyUnorderedCheckoutStockOnce(input);
}
