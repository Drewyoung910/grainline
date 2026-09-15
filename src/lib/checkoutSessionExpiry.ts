import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";
import { restoreSellerExpiredCheckoutStockOnce } from "@/lib/checkoutStockRestore";
import { checkoutSessionMetadataReferencesListing } from "@/lib/checkoutSessionExpiryState";
import { expireClosedSellerAccountSessions } from "@/lib/orderSellerClosureSessions";
export { checkoutSessionMetadataReferencesListing } from "@/lib/checkoutSessionExpiryState";

export type ExpireOpenCheckoutSessionsResult = {
  checked: number;
  expired: number;
  failed: number;
};

// Unlike the best-effort seller/listing sweeps below, signed terminal account
// closure must preserve account identity and propagate unresolved failures.
export async function expireCheckoutSessionsForClosedAccount(input: {
  sellerId: string;
  stripeAccountId: string;
}) {
  return expireClosedSellerAccountSessions<Stripe.Checkout.Session>({
    sellerId: input.sellerId,
    accountId: input.stripeAccountId,
    nowSeconds: Math.floor(Date.now() / 1000),
  }, {
    list: async (params) => stripe.checkout.sessions.list(params),
    expire: async (id) => stripe.checkout.sessions.expire(id),
    retrieve: async (id) => stripe.checkout.sessions.retrieve(id),
    restore: async (session) => restoreSellerExpiredCheckoutStockOnce({
      sellerProfileId: input.sellerId,
      sessionId: session.id,
      metadata: session.metadata ?? {},
    }),
  });
}

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
  sellerProfileId: string,
  source: string,
  extra: Record<string, string | null | undefined>,
) {
  await restoreSellerExpiredCheckoutStockOnce({
    sellerProfileId,
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
        await restoreExpiredCheckoutSessionStock(session, sellerId, source, { sellerId, stripeAccountId });
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
  sellerId: string;
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
      if (session.metadata?.sellerId && session.metadata.sellerId !== sellerId) continue;
      if (!(await checkoutSessionBelongsToListing(session, listingId))) continue;
      result.checked += 1;
      try {
        await stripe.checkout.sessions.expire(session.id);
        await restoreExpiredCheckoutSessionStock(session, sellerId, source, { listingId, sellerId });
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
