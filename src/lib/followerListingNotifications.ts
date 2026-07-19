import { prisma } from "@/lib/db";
import { renderNewListingFromFollowedMakerEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { publicListingPath } from "@/lib/publicPaths";
import { formatCurrencyCents } from "@/lib/money";
import { EMAIL_APP_URL } from "@/lib/emailBaseUrl";
import { publicListingWhere } from "@/lib/listingVisibility";

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
      select: { id: true, followerId: true, follower: { select: { email: true } } },
    });

    if (followers.length === 0) return;

    await mapWithConcurrency(followers, 10, (f) =>
      createNotification({
        userId: f.followerId,
        type: "FOLLOWED_MAKER_NEW_LISTING",
        title: `New listing from ${sellerDisplay}`,
        body: publicListing.title,
        link: listingPath,
        sourceType: "followed_maker_new_listing",
        sourceId: publicListing.id,
        relatedUserId: sellerUserId,
      }),
    );

    await mapWithConcurrency(followers.filter((f) => f.follower?.email), 5, async (f) => {
      if (await shouldSendEmail(f.followerId, "EMAIL_FOLLOWED_MAKER_NEW_LISTING")) {
        const email = renderNewListingFromFollowedMakerEmail({
          to: f.follower.email!,
          makerName: sellerDisplay,
          listingTitle: publicListing.title,
          listingPrice,
          listingUrl,
        });
        await enqueueEmailOutbox({
          ...email,
          dedupKey: emailDedupKey(f.followerId),
          templateName: "followed_maker_new_listing",
          userId: f.followerId,
          preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
          sourceType: "followed_maker_new_listing",
          sourceId: publicListing.id,
        });
      }
    });

    if (followers.length < FOLLOWER_FANOUT_PAGE_SIZE) return;
    cursor = followers[followers.length - 1].id;
  }
}
