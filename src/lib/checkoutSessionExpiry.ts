import * as Sentry from "@sentry/nextjs";
import type Stripe from "stripe";
import { prisma } from "@/lib/db";
import { stripe } from "@/lib/stripe";

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
