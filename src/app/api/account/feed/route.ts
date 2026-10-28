// src/app/api/account/feed/route.ts
import { NextRequest } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import {
  accountFeedCursorTieMode,
  buildAccountFeedCursor,
  compareAccountFeedItemsDesc,
  isAccountFeedItemAfterCursor,
  parseAccountFeedCursor,
  type AccountFeedKind,
} from "@/lib/accountFeedCursor";
import { accountFeedRatelimit, rateLimitResponse, safeRateLimit } from "@/lib/ratelimit";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { ownerSavedBlogPostIdRows } from "@/lib/savedBlogPostOwnerAccess";
import { sellerActorAccountFeedCards } from "@/lib/sellerProfileParticipantAccess";
import { ownerFavoriteListingIds } from "@/lib/favoriteAccess";
import { ownerFollowedSellerIds } from "@/lib/sellerFollowAccess";

const MAX_FOLLOWED_SELLERS_FOR_FEED = 1000;

export type FeedItem = {
  kind: "listing" | "blog" | "broadcast";
  date: string;
  // listing fields
  id?: string;
  title?: string;
  priceCents?: number;
  currency?: string;
  imageUrl?: string | null;
  sellerName?: string;
  sellerProfileId?: string;
  guildLevel?: string;
  // blog fields
  slug?: string;
  excerpt?: string | null;
  coverImageUrl?: string | null;
  publishedAt?: string;
  // broadcast fields
  message?: string;
  broadcastImageUrl?: string | null;
  sentAt?: string;
  // Whether the viewer has already favorited (listing) / saved (blog).
  // Used to set the initial state on FavoriteButton / SaveBlogButton in
  // the feed UI so the heart/bookmark renders filled when applicable.
  isSaved?: boolean;
};

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const rate = await safeRateLimit(accountFeedRatelimit, me.id);
  if (!rate.success) return privateResponse(rateLimitResponse(rate.reset, "Too many feed requests."));

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = parseBoundedPositiveIntParam(url.searchParams.get("limit"), 20, 50);
  const take = limit + 1;
  const parsedCursor = parseAccountFeedCursor(cursor);

  // Get followed seller profile IDs
  const followedSellerIds = await ownerFollowedSellerIds(
    me.id,
    MAX_FOLLOWED_SELLERS_FOR_FEED,
  );
  const rawSellerIds = [...followedSellerIds];
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(me.id);
  const blockedSellerIdSet = new Set(blockedSellerIds);
  const sellerIds = blockedSellerIds.length > 0
    ? rawSellerIds.filter((id) => !blockedSellerIdSet.has(id))
    : rawSellerIds;
  if (sellerIds.length === 0) {
    const message =
      rawSellerIds.length > 0 && blockedSellerIds.length > 0
        ? "All followed makers are currently blocked."
        : undefined;
    return privateJson({ items: [], nextCursor: null, hasMore: false, message });
  }

  const initialSellerCards = await sellerActorAccountFeedCards(me.id, sellerIds);
  const visibleSellerIds = initialSellerCards.map((seller) => seller.id);

  if (visibleSellerIds.length === 0) {
    return privateJson({
      items: [],
      nextCursor: null,
      hasMore: false,
      message: "The makers you follow are not currently selling. Check back when they reopen their shops.",
    });
  }

  // First page: 90-day cutoff. Subsequent pages: use cursor (fetch items older than cursor).
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const timestampCursorWhere = (kind: AccountFeedKind, dateField: "createdAt" | "publishedAt" | "sentAt") => {
    if (!parsedCursor) return { [dateField]: { gte: cutoff } };
    if (parsedCursor.legacy) return { [dateField]: { lt: parsedCursor.date } };

    const sameTimestampMode = accountFeedCursorTieMode(kind, parsedCursor);
    const sameTimestamp =
      sameTimestampMode === "all"
        ? [{ [dateField]: parsedCursor.date }]
        : sameTimestampMode === "after-id" && parsedCursor.id
          ? [{ [dateField]: parsedCursor.date, id: { lt: parsedCursor.id } }]
          : [];
    return { OR: [{ [dateField]: { lt: parsedCursor.date } }, ...sameTimestamp] };
  };

  const [listings, blogPosts, broadcasts] = await Promise.all([
    prisma.listing.findMany({
      where: {
        sellerId: { in: visibleSellerIds },
        status: "ACTIVE",
        isPrivate: false,
        ...timestampCursorWhere("listing", "createdAt"),
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        title: true,
        priceCents: true,
        currency: true,
        createdAt: true,
        sellerId: true,
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      },
    }),
    prisma.blogPost.findMany({
      where: {
        sellerProfileId: { in: visibleSellerIds },
        status: "PUBLISHED",
        publishedAt: { not: null },
        ...timestampCursorWhere("blog", "publishedAt"),
        authorAccountActive: true,
      },
      orderBy: [{ publishedAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        slug: true,
        title: true,
        excerpt: true,
        coverImageUrl: true,
        publishedAt: true,
        sellerProfileId: true,
      },
    }),
    prisma.sellerBroadcast.findMany({
      where: {
        sellerProfileId: { in: visibleSellerIds },
        ...timestampCursorWhere("broadcast", "sentAt"),
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        message: true,
        imageUrl: true,
        sentAt: true,
        sellerProfileId: true,
      },
    }),
  ]);

  // Re-check seller readiness and blocks after reading the feed rows. This
  // closes the same state-change window that the predecessor relation filters
  // closed independently in each query, while keeping SellerProfile authority
  // inside the bounded actor operation.
  const resultSellerIds = [...new Set([
    ...listings.map((listing) => listing.sellerId),
    ...blogPosts.flatMap((post) => post.sellerProfileId ? [post.sellerProfileId] : []),
    ...broadcasts.map((broadcast) => broadcast.sellerProfileId),
  ])];
  const currentSellerCards = await sellerActorAccountFeedCards(me.id, resultSellerIds);
  const sellerCardsById = new Map(currentSellerCards.map((seller) => [seller.id, seller]));
  const visibleListings = listings.filter((listing) => sellerCardsById.has(listing.sellerId));
  const visibleBlogPosts = blogPosts.filter((post) => (
    post.sellerProfileId != null && sellerCardsById.has(post.sellerProfileId)
  ));
  const visibleBroadcasts = broadcasts.filter((broadcast) => (
    sellerCardsById.has(broadcast.sellerProfileId)
  ));

  // Build saved-state lookups so the cards can render with the right
  // heart/bookmark fill. Two parallel queries scoped to just the listing
  // and blog post ids in this feed page — cheap, indexed lookups.
  const listingIds = visibleListings.map((l) => l.id);
  const blogPostIds = visibleBlogPosts.map((b) => b.id);
  const [favoritedListingIds, savedBlogPosts] = await Promise.all([
    ownerFavoriteListingIds(me.id, listingIds),
    ownerSavedBlogPostIdRows(me.id, blogPostIds),
  ]);
  const savedBlogPostIds = new Set(savedBlogPosts.map((s) => s.blogPostId));

  const merged: FeedItem[] = [
    ...visibleListings.map((l): FeedItem => ({
      kind: "listing",
      date: l.createdAt.toISOString(),
      id: l.id,
      title: l.title,
      priceCents: l.priceCents,
      currency: l.currency,
      imageUrl: l.photos[0]?.url ?? null,
      sellerName: sellerCardsById.get(l.sellerId)!.displayName,
      sellerProfileId: l.sellerId,
      guildLevel: sellerCardsById.get(l.sellerId)!.guildLevel,
      isSaved: favoritedListingIds.has(l.id),
    })),
    ...visibleBlogPosts.map((b): FeedItem => ({
      kind: "blog",
      date: (b.publishedAt ?? new Date(0)).toISOString(),
      id: b.id,
      slug: b.slug,
      title: b.title,
      excerpt: b.excerpt,
      coverImageUrl: b.coverImageUrl,
      sellerName: sellerCardsById.get(b.sellerProfileId!)!.displayName,
      sellerProfileId: b.sellerProfileId ?? "",
      guildLevel: sellerCardsById.get(b.sellerProfileId!)!.guildLevel,
      publishedAt: (b.publishedAt ?? new Date(0)).toISOString(),
      isSaved: savedBlogPostIds.has(b.id),
    })),
    ...visibleBroadcasts.map((br): FeedItem => ({
      kind: "broadcast",
      date: br.sentAt.toISOString(),
      id: br.id,
      message: br.message,
      broadcastImageUrl: br.imageUrl,
      sellerName: sellerCardsById.get(br.sellerProfileId)!.displayName,
      sellerProfileId: br.sellerProfileId,
      sentAt: br.sentAt.toISOString(),
    })),
  ]
    .sort(compareAccountFeedItemsDesc)
    .filter((item) => !parsedCursor || isAccountFeedItemAfterCursor(item, parsedCursor));

  const hasMore = merged.length > limit;
  const pageItems = merged.slice(0, limit);
  const nextCursor = hasMore && pageItems.length > 0 ? buildAccountFeedCursor(pageItems[pageItems.length - 1]) : null;

  return privateJson({ items: pageItems, nextCursor, hasMore });
}
