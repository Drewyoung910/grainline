import { prisma } from "@/lib/db";
import { renderNewListingFromFollowedMakerEmail } from "@/lib/email";
import { enqueueEmailOutbox } from "@/lib/emailOutbox";
import { createNotification, shouldSendEmail } from "@/lib/notifications";
import { mapWithConcurrency } from "@/lib/concurrency";
import { publicListingPath } from "@/lib/publicPaths";

const FOLLOWER_FANOUT_PAGE_SIZE = 1000;

type ListingForFanout = {
  id: string;
  title: string;
  priceCents: number;
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
  const listingUrl = `${process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com"}${listingPath}`;
  const listingPrice = `$${(listing.priceCents / 100).toFixed(2)}`;
  let cursor: string | undefined;

  while (true) {
    const followers = await prisma.follow.findMany({
      where: {
        sellerProfileId,
        follower: { banned: false, deletedAt: null },
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
          userId: f.followerId,
          preferenceKey: "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
        });
      }
    });

    if (followers.length < FOLLOWER_FANOUT_PAGE_SIZE) return;
    cursor = followers[followers.length - 1].id;
  }
}
