import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { renderNewListingFromFollowedMakerEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { chunkArray, mapWithConcurrency } from "@/lib/concurrency";
import { publicListingPath } from "@/lib/publicPaths";
import { formatCurrencyCents } from "@/lib/money";
import { EMAIL_APP_URL } from "@/lib/emailBaseUrl";
import { sellerPublicFollowerListingTarget } from "@/lib/sellerProfilePublicAccess";
import { userEmailDeliveryRecipients } from "@/lib/userEmailDeliveryAccess";
import { userFollowerNotificationPage } from "@/lib/userFollowerAccess";

const FOLLOWER_FANOUT_PAGE_SIZE = 1000;

type ListingForFanout = {
  id: string;
  title: string;
  priceCents: number;
  currency: string | null;
};

export async function fanOutListingToFollowers({
  sellerProfileId,
  sellerDisplayName,
  listing,
}: {
  sellerProfileId: string;
  sellerDisplayName: string | null;
  listing: ListingForFanout;
}) {
  const publicListing = await sellerPublicFollowerListingTarget(
    listing.id,
    sellerProfileId,
  );
  if (!publicListing) return;
  const sellerUserId = publicListing.seller.userId;
  const sellerDisplay = publicListing.seller.displayName ?? sellerDisplayName ?? "A maker you follow";
  const listingPath = publicListingPath(publicListing.id, publicListing.title);
  const listingUrl = `${EMAIL_APP_URL}${listingPath}`;
  const listingPrice = formatCurrencyCents(publicListing.priceCents, publicListing.currency);
  const coverPhoto = await prisma.photo.findFirst({
    where: { listingId: publicListing.id },
    orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
    select: { url: true },
  });
  let cursor: string | undefined;

  while (true) {
    const followers = await userFollowerNotificationPage(prisma, {
      sourceType: NOTIFICATION_SOURCE_TYPES.FOLLOWED_MAKER_NEW_LISTING,
      sourceId: publicListing.id,
      afterFollowId: cursor,
      limit: FOLLOWER_FANOUT_PAGE_SIZE,
    });

    if (followers.length === 0) return;

    const notificationResults = await mapWithConcurrency(followers, 10, (f) =>
      createNotification({
        userId: f.followerId,
        type: "FOLLOWED_MAKER_NEW_LISTING",
        title: `New listing from ${sellerDisplay}`,
        body: publicListing.title,
        link: listingPath,
        sourceType: NOTIFICATION_SOURCE_TYPES.FOLLOWED_MAKER_NEW_LISTING,
        sourceId: publicListing.id,
        relatedUserId: sellerUserId,
      }),
    );

    const emailRecipients = (await Promise.all(
      chunkArray(followers.map((f) => f.followerId), 500).map((userIds) =>
        userEmailDeliveryRecipients(prisma, {
          userIds,
          preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
        }),
      ),
    )).flat();
    const emailResults = await mapWithConcurrency(emailRecipients, 5, async (recipient) => {
      const email = renderNewListingFromFollowedMakerEmail({
        to: recipient.email,
        makerName: sellerDisplay,
        listingTitle: publicListing.title,
        listingPrice,
        listingUrl,
        listingImageUrl: coverPhoto?.url,
      });
      await enqueueEmailOutbox({
        ...email,
        // One key per follower and listing, so re-listing an old piece cannot email
        // the same follower "just posted a new listing" again from another path.
        dedupKey: `followed-listing:${publicListing.id}:${recipient.userId}`,
        templateName: "followed_maker_new_listing",
        userId: recipient.userId,
        preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
        sourceType: "followed_maker_new_listing",
        sourceId: publicListing.id,
      });
    });

    const failed = [...notificationResults, ...emailResults]
      .filter((result) => result.status === "rejected");
    if (failed.length > 0) {
      Sentry.captureException(failed[0].reason, {
        level: "warning",
        tags: { source: "followed_maker_listing_fanout" },
        extra: { listingId: publicListing.id, failedCount: failed.length },
      });
    }

    if (followers.length < FOLLOWER_FANOUT_PAGE_SIZE) return;
    cursor = followers[followers.length - 1].followId;
  }
}
