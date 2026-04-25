// src/app/api/account/feed/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";

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

  const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 401 });

  const url = new URL(req.url);
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(parseInt(url.searchParams.get("limit") ?? "20", 10), 50);
  const take = limit + 1;

  // Get followed seller profile IDs
  const follows = await prisma.follow.findMany({
    where: { followerId: me.id },
    select: { sellerProfileId: true },
  });
  const rawSellerIds = follows.map((f) => f.sellerProfileId);
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(me.id);
  const sellerIds = blockedSellerIds.length > 0
    ? rawSellerIds.filter((id) => !blockedSellerIds.includes(id))
    : rawSellerIds;

  if (sellerIds.length === 0) {
    return NextResponse.json({ items: [], nextCursor: null, hasMore: false });
  }

  // First page: 90-day cutoff. Subsequent pages: use cursor (fetch items older than cursor).
  const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const listingDateFilter = cursor ? { lt: new Date(cursor) } : { gte: cutoff };
  const blogDateFilter = cursor ? { lt: new Date(cursor), not: null as null } : { gte: cutoff, not: null as null };
  const broadcastDateFilter = cursor ? { lt: new Date(cursor) } : { gte: cutoff };
  const followedSellerVisibility = {
    chargesEnabled: true,
    vacationMode: false,
    user: { banned: false, deletedAt: null },
  };

  const [listings, blogPosts, broadcasts] = await Promise.all([
    prisma.listing.findMany({
      where: {
        sellerId: { in: sellerIds },
        status: "ACTIVE",
        isPrivate: false,
        createdAt: listingDateFilter,
        seller: followedSellerVisibility,
      },
      orderBy: { createdAt: "desc" },
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
        sellerProfileId: { in: sellerIds },
        status: "PUBLISHED",
        publishedAt: blogDateFilter,
        author: { banned: false, deletedAt: null },
        sellerProfile: followedSellerVisibility,
      },
      orderBy: { publishedAt: "desc" },
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
        sellerProfileId: { in: sellerIds },
        sentAt: broadcastDateFilter,
        sellerProfile: followedSellerVisibility,
      },
      orderBy: { sentAt: "desc" },
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
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const hasMore = merged.length > limit;
  const pageItems = merged.slice(0, limit);
  const nextCursor = hasMore && pageItems.length > 0 ? pageItems[pageItems.length - 1].date : null;

  return NextResponse.json({ items: pageItems, nextCursor, hasMore });
}
