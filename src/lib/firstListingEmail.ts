import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { renderFirstListingCongratsEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { userEmailDeliveryRecipient } from "@/lib/userEmailDeliveryAccess";

/**
 * Call only after a public listing has actually gone live. A listing held for
 * review must not trigger "your first piece is live". HIDDEN counts as having
 * been live because only a previously public listing can enter that state.
 */
export async function sendFirstListingCongratsIfFirst({
  sellerProfileId,
  sellerUserId,
  sellerDisplayName,
  listing,
}: {
  sellerProfileId: string;
  sellerUserId: string;
  sellerDisplayName: string | null;
  listing: { id: string; title: string; priceCents: number; currency: string | null };
}) {
  try {
    const publishedCount = await prisma.listing.count({
      where: {
        sellerId: sellerProfileId,
        isPrivate: false,
        status: { in: ["ACTIVE", "SOLD", "SOLD_OUT", "HIDDEN"] },
      },
    });
    if (publishedCount !== 1) return;

    const recipient = await userEmailDeliveryRecipient(prisma, { userId: sellerUserId });
    if (!recipient) return;

    await enqueueEmailOutbox({
      ...renderFirstListingCongratsEmail({
        seller: { displayName: sellerDisplayName, email: recipient.email },
        listing,
      }),
      dedupKey: `first-listing-congrats:${sellerProfileId}`,
      templateName: "first_listing_congrats",
      userId: sellerUserId,
    });
  } catch (error) {
    // Email is best effort and must never roll back publication.
    Sentry.captureException(error, {
      level: "warning",
      tags: { source: "first_listing_congrats" },
      extra: { sellerProfileId, listingId: listing.id },
    });
  }
}
