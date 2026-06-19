import { prisma } from "@/lib/db";
import { renderNewListingFromFollowedMakerEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { publicListingPath } from "@/lib/publicPaths";
import { formatCurrencyCents } from "@/lib/money";
import { EMAIL_APP_URL } from "@/lib/emailBaseUrl";

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
  const sellerDisplay = sellerDisplayName ?? "A maker you follow";
  const listingPath = publicListingPath(listing.id, listing.title);
  const listingUrl = `${EMAIL_APP_URL}${listingPath}`;
  const listingPrice = formatCurrencyCents(listing.priceCents, listing.currency);
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerProfileId },
    select: { userId: true },
  });
  if (!seller) return;
  let cursor: string | undefined;

  while (true) {
    const followers = await prisma.follow.findMany({
      where: {
        sellerProfileId,
        followerId: { not: seller.userId },
        follower: {
          banned: false,
          deletedAt: null,
          blocks: { none: { blockedId: seller.userId } },
          blockedBy: { none: { blockerId: seller.userId } },
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
        body: listing.title,
        link: listingPath,
        sourceType: "followed_maker_new_listing",
        sourceId: listing.id,
      }),
    );

    await mapWithConcurrency(followers.filter((f) => f.follower?.email), 5, async (f) => {
      if (await shouldSendEmail(f.followerId, "EMAIL_FOLLOWED_MAKER_NEW_LISTING")) {
        const email = renderNewListingFromFollowedMakerEmail({
          to: f.follower.email!,
          makerName: sellerDisplay,
          listingTitle: listing.title,
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
          sourceId: listing.id,
        });
      }
    });

    if (followers.length < FOLLOWER_FANOUT_PAGE_SIZE) return;
    cursor = followers[followers.length - 1].id;
  }
}
