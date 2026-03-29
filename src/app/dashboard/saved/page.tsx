// src/app/dashboard/saved/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { ListingStatus } from "@prisma/client";
import FavoriteButton from "@/components/FavoriteButton";

const PAGE_SIZE = 24;

type Search = {
  sort?: "saved_newest" | "price_low" | "price_high";
  page?: string;
};

type SellerRating = { avgStars: number; count: number };

export default async function SavedPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/saved");

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
    select: { id: true },
  });
  if (!me) redirect("/sign-in?redirect_url=/dashboard/saved");

  // Await the async searchParams
  const { sort = "saved_newest", page = "1" } = await searchParams;

  const pageNumRaw = Number.parseInt(page || "1", 10);
  const pageNum = Number.isFinite(pageNumRaw) && pageNumRaw > 0 ? pageNumRaw : 1;

  // Sorting: default by Favorite.createdAt (most recently saved)
  const orderBy =
    sort === "price_low"
      ? { listing: { priceCents: "asc" as const } }
      : sort === "price_high"
      ? { listing: { priceCents: "desc" as const } }
      : { createdAt: "desc" as const }; // saved_newest (Favorite.createdAt)

  const where = {
    userId: me.id,
    listing: { status: ListingStatus.ACTIVE },
  };

  const [rows, total] = await Promise.all([
    prisma.favorite.findMany({
      where,
      orderBy,
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        listing: {
          include: {
            photos: {
              take: 1,
              orderBy: { sortOrder: "asc" },
              select: { url: true },
            },
            seller: { include: { user: true } },
          },
        },
      },
    }),
    prisma.favorite.count({ where }),
  ]);

  // ---------- NEW: Batch compute shop (seller) ratings ----------
  const sellerIds = Array.from(
    new Set(rows.map((f) => f.listing.sellerId).filter(Boolean))
  ) as string[];

  let sellerRatings = new Map<string, SellerRating>();

  if (sellerIds.length) {
    // 1) Group reviews by listing to get per-listing avg & count (only for listings whose seller is on this page)
    const perListing = await prisma.review.groupBy({
      by: ["listingId"],
      where: { listing: { sellerId: { in: sellerIds } } },
      _avg: { ratingX2: true },
      _count: { _all: true },
    });

    if (perListing.length) {
      // 2) Map listingId -> sellerId
      const listingIds = perListing.map((g) => g.listingId);
      const listingOwners = await prisma.listing.findMany({
        where: { id: { in: listingIds } },
        select: { id: true, sellerId: true },
      });
      const ownerByListing = new Map(
        listingOwners.map((r) => [r.id, r.sellerId])
      );

      // 3) Reduce to per-seller weighted averages
      const sumX2BySeller = new Map<string, number>();
      const countBySeller = new Map<string, number>();

      for (const g of perListing) {
        const sellerId = ownerByListing.get(g.listingId);
        if (!sellerId) continue;
        const count = g._count._all || 0;
        const avgX2 = g._avg.ratingX2 ?? 0;
        if (count === 0) continue;

        sumX2BySeller.set(
          sellerId,
          (sumX2BySeller.get(sellerId) ?? 0) + avgX2 * count
        );
        countBySeller.set(sellerId, (countBySeller.get(sellerId) ?? 0) + count);
      }

      sellerRatings = new Map(
        Array.from(countBySeller.entries()).map(([sid, cnt]) => {
          const sumX2 = sumX2BySeller.get(sid) ?? 0;
          const avgStars = cnt > 0 ? (sumX2 / cnt) / 2 : 0; // convert x2 → stars
          return [sid, { avgStars, count: cnt }];
        })
      );
    }
  }
  // --------------------------------------------------------------

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(pageNum, 1), totalPages);
  const from = total === 0 ? 0 : (clampedPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, clampedPage * PAGE_SIZE);

  const makeHref = (n: number, nextSort = sort) => {
    const params = new URLSearchParams();
    params.set("sort", nextSort);
    params.set("page", String(n));
    return `/dashboard/saved?${params.toString()}`;
  };

  const sortLinkClass = (key: Search["sort"]) =>
    `rounded-full border px-3 py-1 text-sm ${
      sort === key ? "bg-black text-white border-black" : "hover:bg-neutral-50"
    }`;

  return (
    <main className="max-w-6xl mx-auto p-8">
      <header className="mb-8 flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">Saved items</h1>
          <p className="text-sm text-neutral-500 mt-1">
            {total === 0 ? (
              "No saved items yet"
            ) : (
              <>
                Showing <span className="font-medium">{from}-{to}</span> of {total} saved
              </>
            )}
          </p>
        </div>

        {/* Sort controls */}
        <nav className="flex items-center gap-2">
          <Link href={makeHref(1, "saved_newest")} className={sortLinkClass("saved_newest")}>
            Newest saved
          </Link>
          <Link href={makeHref(1, "price_low")} className={sortLinkClass("price_low")}>
            Price ↑
          </Link>
          <Link href={makeHref(1, "price_high")} className={sortLinkClass("price_high")}>
            Price ↓
          </Link>
        </nav>
      </header>

      {total === 0 ? (
        <div className="rounded-xl border p-10 text-center">
          <p className="text-neutral-600">
            Nothing saved yet — start hearting pieces you love while browsing.
          </p>
          <div className="mt-4">
            <Link href="/browse" className="rounded-lg border px-4 py-2 hover:bg-neutral-50">
              Go to Browse
            </Link>
          </div>
        </div>
      ) : (
        <>
          <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
            {rows.map((f) => {
              const l = f.listing;
              const img = l.photos[0]?.url ?? "/favicon.ico";
              const sellerName = l.seller.displayName ?? l.seller.user?.email ?? "Seller";
              const sellerHref = `/seller/${l.sellerId}`;
              const sellerAvatar = l.seller.avatarImageUrl ?? l.seller.user?.imageUrl ?? null;
              const initials =
                (sellerName || "S")
                  .split(/\s+/)
                  .filter(Boolean)
                  .slice(0, 2)
                  .map((w) => w[0]?.toUpperCase() ?? "")
                  .join("") || "S";

              // NEW: seller rating for this card
              const sr = sellerRatings.get(l.sellerId);
              const hasRating = sr && sr.count > 0;
              const starsPct = hasRating ? (Math.min(5, Math.max(0, Math.round(sr!.avgStars * 4) / 4)) / 5) * 100 : 0;

              return (
                <li key={l.id} className="border rounded-xl overflow-hidden">
                  <div className="relative">
                    <Link href={`/listing/${l.id}`} className="block">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img alt={l.title} src={img} className="w-full h-48 object-cover" />
                    </Link>
                    <div className="absolute top-2 right-2">
                      <FavoriteButton listingId={l.id} initialSaved />
                    </div>
                  </div>

                  <Link href={`/listing/${l.id}`} className="block">
                    <div className="p-4 space-y-2">
                      <div className="flex items-baseline justify-between">
                        <div className="font-medium">{l.title}</div>
                        <div className="opacity-70">
                          ${(l.priceCents / 100).toFixed(2)}
                        </div>
                      </div>

                      {/* NEW: Shop rating line */}
                      {hasRating ? (
                        <div className="flex items-center gap-2 text-xs text-neutral-700" title={`${sr!.avgStars.toFixed(1)} out of 5`}>
                          <div className="relative leading-none">
                            <div className="text-neutral-300">★★★★★</div>
                            <div className="absolute inset-0 overflow-hidden" style={{ width: `${starsPct}%` }}>
                              <div className="text-amber-500">★★★★★</div>
                            </div>
                          </div>
                          <span>{sr!.avgStars.toFixed(1)}</span>
                          <span className="text-neutral-400">({sr!.count})</span>
                          <span className="ml-1 text-neutral-400">· Shop rating</span>
                        </div>
                      ) : (
                        <div className="text-xs text-neutral-400">No shop ratings yet</div>
                      )}
                    </div>
                  </Link>

                  <div className="px-4 pb-4">
                    <Link
                      href={sellerHref}
                      className="inline-flex items-center gap-2 text-xs rounded-full border px-3 py-1 hover:bg-neutral-50"
                    >
                      {sellerAvatar ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={sellerAvatar} alt={sellerName} className="h-5 w-5 rounded-full object-cover" />
                      ) : (
                        <div className="h-5 w-5 rounded-full bg-neutral-200 flex items-center justify-center">
                          <span className="text-[10px] font-medium text-neutral-700">{initials}</span>
                        </div>
                      )}
                      <span>{sellerName}</span>
                    </Link>
                  </div>
                </li>
              );
            })}
          </ul>

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2 text-sm">
              {clampedPage > 1 ? (
                <Link href={makeHref(clampedPage - 1)} className="rounded border px-3 py-1 hover:bg-neutral-50">
                  ← Prev
                </Link>
              ) : (
                <span className="rounded border px-3 py-1 text-neutral-400">← Prev</span>
              )}
              <span className="px-2 text-neutral-500">
                Page <span className="font-medium">{clampedPage}</span> of {totalPages}
              </span>
              {clampedPage < totalPages ? (
                <Link href={makeHref(clampedPage + 1)} className="rounded border px-3 py-1 hover:bg-neutral-50">
                  Next →
                </Link>
              ) : (
                <span className="rounded border px-3 py-1 text-neutral-400">Next →</span>
              )}
            </div>
          )}
        </>
      )}
    </main>
  );
}


