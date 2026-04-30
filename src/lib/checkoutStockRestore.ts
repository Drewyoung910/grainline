import * as Sentry from "@sentry/nextjs";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import { releaseCheckoutLock } from "@/lib/checkoutSessionLock";
import { parsePositiveInt } from "@/lib/stripeWebhookState";

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
  for (const item of mergeRestorableStockItems(items)) {
    await tx.$executeRaw`
      UPDATE "Listing"
      SET "stockQuantity" = "stockQuantity" + ${item.quantity}
      WHERE id = ${item.listingId}
        AND "listingType" = 'IN_STOCK'
    `;
    await tx.listing.updateMany({
      where: { id: item.listingId, status: "SOLD_OUT", stockQuantity: { gt: 0 } },
      data: { status: "ACTIVE" },
    });
  }
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
  await prisma.$transaction(async (tx) => {
    await lockCheckoutSessionMutation(tx, input.sessionId);

    const orderExists = await tx.order.findFirst({
      where: { stripeSessionId: input.sessionId },
      select: { id: true },
    });
    if (orderExists) return;

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
      return;
    }

    const claimed = await claimCheckoutStockRestore(tx, input.sessionId);
    if (!claimed) return;

    await restoreReservedStockItems(tx, items);
  });

  await releaseCheckoutLock(input.metadata.checkoutLockKey, input.sessionId);
}
