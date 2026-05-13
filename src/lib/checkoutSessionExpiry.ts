import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { restoreUnorderedCheckoutStockOnce } from "@/lib/checkoutStockRestore";
import { checkoutSessionMetadataReferencesListing } from "@/lib/checkoutSessionExpiryState";
export { checkoutSessionMetadataReferencesListing } from "@/lib/checkoutSessionExpiryState";

export type ExpireOpenCheckoutSessionsResult = {
  checked: number;
  expired: number;
  failed: number;
};

async function checkoutSessionBelongsToSeller(session: Stripe.Checkout.Session, sellerId: string) {
  const metadata = session.metadata ?? {};
  if (metadata.sellerId === sellerId) return true;
  if (!metadata.listingId) return false;
  const listing = await prisma.listing.findUnique({
    where: { id: metadata.listingId },
    select: { sellerId: true },
  });
  return listing?.sellerId === sellerId;
}

async function checkoutSessionBelongsToListing(session: Stripe.Checkout.Session, listingId: string) {
  if (checkoutSessionMetadataReferencesListing(session.metadata, listingId)) return true;

  try {
    const fullSession = await stripe.checkout.sessions.retrieve(session.id, {
      expand: ["line_items.data.price.product"],
    });
    const lineItems = (fullSession as { line_items?: { data?: Array<{ price?: { product?: Stripe.Product | string | null } | null }> } }).line_items?.data ?? [];
    return lineItems.some((lineItem) => {
      const product = typeof lineItem.price?.product === "object" ? lineItem.price.product : null;
      return product?.metadata?.listingId === listingId;
    });
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "listing_checkout_session_line_items_retrieve" },
      extra: { listingId, stripeSessionId: session.id },
    });
    return false;
  }
}

async function restoreExpiredCheckoutSessionStock(
  session: Stripe.Checkout.Session,
  source: string,
  extra: Record<string, string | null | undefined>,
) {
  await restoreUnorderedCheckoutStockOnce({
    sessionId: session.id,
    metadata: session.metadata ?? {},
  }).catch((error) => {
    Sentry.captureException(error, {
      tags: { source: `${source}_checkout_session_restore` },
      extra: { ...extra, stripeSessionId: session.id },
    });
  });
}

export async function expireOpenCheckoutSessionsForSeller({
  sellerId,
  stripeAccountId,
  source,
  lookbackSeconds = 2 * 60 * 60,
}: {
  sellerId: string;
  stripeAccountId?: string | null;
  source: string;
  lookbackSeconds?: number;
}): Promise<ExpireOpenCheckoutSessionsResult> {
  let startingAfter: string | undefined;
  let pages = 0;
  const createdAfter = Math.floor(Date.now() / 1000) - lookbackSeconds;
  const result: ExpireOpenCheckoutSessionsResult = { checked: 0, expired: 0, failed: 0 };

  do {
    let sessions: Stripe.ApiList<Stripe.Checkout.Session>;
    try {
      sessions = await stripe.checkout.sessions.list({
        created: { gte: createdAfter },
        limit: 100,
        status: "open",
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: `${source}_checkout_session_list` },
        extra: { sellerId, stripeAccountId },
      });
      return result;
    }

    for (const session of sessions.data) {
      if (!(await checkoutSessionBelongsToSeller(session, sellerId))) continue;
      result.checked += 1;
      try {
        await stripe.checkout.sessions.expire(session.id);
        await restoreExpiredCheckoutSessionStock(session, source, { sellerId, stripeAccountId });
        result.expired += 1;
      } catch (error) {
        result.failed += 1;
        Sentry.captureException(error, {
          tags: { source: `${source}_checkout_session_expire` },
          extra: { sellerId, stripeAccountId, stripeSessionId: session.id },
        });
      }
    }

    pages += 1;
    startingAfter = sessions.has_more ? sessions.data.at(-1)?.id : undefined;
  } while (startingAfter && pages < 10);

  return result;
}

export async function expireOpenCheckoutSessionsForListing({
  listingId,
  sellerId,
  source,
  lookbackSeconds = 2 * 60 * 60,
}: {
  listingId: string;
  sellerId?: string | null;
  source: string;
  lookbackSeconds?: number;
}): Promise<ExpireOpenCheckoutSessionsResult> {
  let startingAfter: string | undefined;
  let pages = 0;
  const createdAfter = Math.floor(Date.now() / 1000) - lookbackSeconds;
  const result: ExpireOpenCheckoutSessionsResult = { checked: 0, expired: 0, failed: 0 };

  do {
    let sessions: Stripe.ApiList<Stripe.Checkout.Session>;
    try {
      sessions = await stripe.checkout.sessions.list({
        created: { gte: createdAfter },
        limit: 100,
        status: "open",
        ...(startingAfter ? { starting_after: startingAfter } : {}),
      });
    } catch (error) {
      Sentry.captureException(error, {
        tags: { source: `${source}_checkout_session_list` },
        extra: { listingId, sellerId },
      });
      return result;
    }

    for (const session of sessions.data) {
      if (sellerId && session.metadata?.sellerId && session.metadata.sellerId !== sellerId) continue;
      if (!(await checkoutSessionBelongsToListing(session, listingId))) continue;
      result.checked += 1;
      try {
        await stripe.checkout.sessions.expire(session.id);
        await restoreExpiredCheckoutSessionStock(session, source, { listingId, sellerId });
        result.expired += 1;
      } catch (error) {
        result.failed += 1;
        Sentry.captureException(error, {
          tags: { source: `${source}_checkout_session_expire` },
          extra: { listingId, sellerId, stripeSessionId: session.id },
        });
      }
    }

    pages += 1;
    startingAfter = sessions.has_more ? sessions.data.at(-1)?.id : undefined;
  } while (startingAfter && pages < 10);

  return result;
}
