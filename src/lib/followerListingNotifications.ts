import { prisma } from "@/lib/db";
import { renderNewListingFromFollowedMakerEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { createNotification } from "@/lib/notifications";
import { NOTIFICATION_SOURCE_TYPES } from "@/lib/notificationSources";
import { chunkArray, mapWithConcurrency } from "@/lib/concurrency";
import { publicListingPath } from "@/lib/publicPaths";
import { formatCurrencyCents } from "@/lib/money";
import { EMAIL_APP_URL } from "@/lib/emailBaseUrl";
import { publicListingWhere } from "@/lib/listingVisibility";
import { userEmailDeliveryRecipients } from "@/lib/userEmailDeliveryAccess";

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
  emailDedupKey,
}: {
  sellerProfileId: string;
  sellerDisplayName: string | null;
  listing: ListingForFanout;
  emailDedupKey: (followerId: string) => string;
}) {
  const publicListing = await prisma.listing.findFirst({
    where: publicListingWhere({ id: listing.id, sellerId: sellerProfileId }),
    select: {
      id: true,
      title: true,
      priceCents: true,
      currency: true,
      seller: { select: { userId: true, displayName: true } },
    },
  });
  if (!publicListing) return;
  const sellerUserId = publicListing.seller.userId;
  const sellerDisplay = publicListing.seller.displayName ?? sellerDisplayName ?? "A maker you follow";
  const listingPath = publicListingPath(publicListing.id, publicListing.title);
  const listingUrl = `${EMAIL_APP_URL}${listingPath}`;
  const listingPrice = formatCurrencyCents(publicListing.priceCents, publicListing.currency);
  let cursor: string | undefined;

  while (true) {
    const followers = await prisma.follow.findMany({
      where: {
        sellerProfileId,
        followerId: { not: sellerUserId },
        follower: {
          banned: false,
          deletedAt: null,
          blocks: { none: { blockedId: sellerUserId } },
          blockedBy: { none: { blockerId: sellerUserId } },
        },
      },
      orderBy: { id: "asc" },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: FOLLOWER_FANOUT_PAGE_SIZE,
      select: { id: true, followerId: true },
    });

    if (followers.length === 0) return;

    await mapWithConcurrency(followers, 10, (f) =>
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
    await mapWithConcurrency(emailRecipients, 5, async (recipient) => {
      const email = renderNewListingFromFollowedMakerEmail({
        to: recipient.email,
        makerName: sellerDisplay,
        listingTitle: publicListing.title,
        listingPrice,
        listingUrl,
      });
      await enqueueEmailOutbox({
        ...email,
        dedupKey: emailDedupKey(recipient.userId),
        templateName: "followed_maker_new_listing",
        userId: recipient.userId,
        preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
        sourceType: "followed_maker_new_listing",
        sourceId: publicListing.id,
      });
    });

    if (followers.length < FOLLOWER_FANOUT_PAGE_SIZE) return;
    cursor = followers[followers.length - 1].id;
  }
}
