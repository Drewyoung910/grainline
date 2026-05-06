// src/app/api/account/feed/route.ts
import { NextRequest, NextResponse } from "next/server";
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
import { accountFeedRatelimit, rateLimitResponse, safeRateLimitOpen } from "@/lib/ratelimit";

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
};

export async function GET(req: NextRequest) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let me: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    me = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const rate = await safeRateLimitOpen(accountFeedRatelimit, me.id);
  if (!rate.success) return rateLimitResponse(rate.reset, "Too many feed requests.");

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);
  const take = limit + 1;
  const parsedCursor = parseAccountFeedCursor(cursor);

  // Get followed seller profile IDs
  const follows = await prisma.follow.findMany({
    where: { followerId: me.id },
    select: { sellerProfileId: true },
    orderBy: { createdAt: "desc" },
    take: MAX_FOLLOWED_SELLERS_FOR_FEED,
  });
  const rawSellerIds = follows.map((f) => f.sellerProfileId);
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(me.id);
  const blockedSellerIdSet = new Set(blockedSellerIds);
  const sellerIds = blockedSellerIds.length > 0
    ? rawSellerIds.filter((id) => !blockedSellerIdSet.has(id))
    : rawSellerIds;
  const followedSellerVisibility = {
    chargesEnabled: true,
    vacationMode: false,
    user: { banned: false, deletedAt: null },
  };

  if (sellerIds.length === 0) {
    const message =
      rawSellerIds.length > 0 && blockedSellerIds.length > 0
        ? "All followed makers are currently blocked."
        : undefined;
    return NextResponse.json({ items: [], nextCursor: null, hasMore: false, message });
  }

  const visibleSellers = await prisma.sellerProfile.findMany({
    where: { id: { in: sellerIds }, ...followedSellerVisibility },
    select: { id: true },
    take: MAX_FOLLOWED_SELLERS_FOR_FEED,
  });
  const visibleSellerIds = visibleSellers.map((seller) => seller.id);

  if (visibleSellerIds.length === 0) {
    return NextResponse.json({
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
        seller: followedSellerVisibility,
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
        seller: { select: { displayName: true, guildLevel: true } },
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
      },
    }),
    prisma.blogPost.findMany({
      where: {
        sellerProfileId: { in: visibleSellerIds },
        status: "PUBLISHED",
        publishedAt: { not: null },
        ...timestampCursorWhere("blog", "publishedAt"),
        author: { banned: false, deletedAt: null },
        sellerProfile: followedSellerVisibility,
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
        sellerProfile: { select: { displayName: true, guildLevel: true } },
      },
    }),
    prisma.sellerBroadcast.findMany({
      where: {
        sellerProfileId: { in: visibleSellerIds },
        ...timestampCursorWhere("broadcast", "sentAt"),
        sellerProfile: followedSellerVisibility,
      },
      orderBy: [{ sentAt: "desc" }, { id: "desc" }],
      take,
      select: {
        id: true,
        message: true,
        imageUrl: true,
        sentAt: true,
        sellerProfileId: true,
        sellerProfile: { select: { displayName: true } },
      },
    }),
  ]);

  const merged: FeedItem[] = [
    ...listings.map((l): FeedItem => ({
      kind: "listing",
      date: l.createdAt.toISOString(),
      id: l.id,
      title: l.title,
      priceCents: l.priceCents,
      currency: l.currency,
      imageUrl: l.photos[0]?.url ?? null,
      sellerName: l.seller.displayName ?? "Maker",
      sellerProfileId: l.sellerId,
      guildLevel: l.seller.guildLevel,
    })),
    ...blogPosts.map((b): FeedItem => ({
      kind: "blog",
      date: (b.publishedAt ?? new Date(0)).toISOString(),
      id: b.id,
      slug: b.slug,
      title: b.title,
      excerpt: b.excerpt,
      coverImageUrl: b.coverImageUrl,
      sellerName: b.sellerProfile?.displayName ?? "Maker",
      sellerProfileId: b.sellerProfileId ?? "",
      guildLevel: b.sellerProfile?.guildLevel,
      publishedAt: (b.publishedAt ?? new Date(0)).toISOString(),
    })),
    ...broadcasts.map((br): FeedItem => ({
      kind: "broadcast",
      date: br.sentAt.toISOString(),
      id: br.id,
      message: br.message,
      broadcastImageUrl: br.imageUrl,
      sellerName: br.sellerProfile?.displayName ?? "Maker",
      sellerProfileId: br.sellerProfileId,
      sentAt: br.sentAt.toISOString(),
    })),
  ]
    .sort(compareAccountFeedItemsDesc)
    .filter((item) => !parsedCursor || isAccountFeedItemAfterCursor(item, parsedCursor));

  const hasMore = merged.length > limit;
  const pageItems = merged.slice(0, limit);
  const nextCursor = hasMore && pageItems.length > 0 ? buildAccountFeedCursor(pageItems[pageItems.length - 1]) : null;

  return NextResponse.json({ items: pageItems, nextCursor, hasMore });
}
