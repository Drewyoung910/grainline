// src/app/browse/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ListingStatus } from "@prisma/client";
import { auth } from "@clerk/nextjs/server";
import FavoriteButton from "@/components/FavoriteButton";

const PAGE_SIZE = 24;

type Search = {
  q?: string;
  page?: string;
  min?: string; // optional price min (USD)
  max?: string; // optional price max (USD)
  sort?: "newest" | "price_asc" | "price_desc";
};

export default async function BrowsePage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}) {
  // Next 15: await the async searchParams
  const sp = await searchParams;
  const q = sp.q ?? "";
  const page = sp.page ?? "1";
  const min = sp.min ?? "";
  const max = sp.max ?? "";
  const sort = (sp.sort as Search["sort"]) ?? "newest";

  const pageNumRaw = Number.parseInt(page || "1", 10);
  const pageNum = Number.isFinite(pageNumRaw) && pageNumRaw > 0 ? pageNumRaw : 1;

  // Build price filter safely (ignore if blank/invalid)
  const priceFilter: { gte?: number; lte?: number } = {};
  const minNum = Number(min);
  const maxNum = Number(max);
  if (Number.isFinite(minNum) && min !== "") priceFilter.gte = Math.round(minNum * 100);
  if (Number.isFinite(maxNum) && max !== "") priceFilter.lte = Math.round(maxNum * 100);

  // WHERE
  const where: any = {
    status: ListingStatus.ACTIVE,
  };
  if (q) {
    where.OR = [
      { title: { contains: q, mode: "insensitive" as const } },
      { description: { contains: q, mode: "insensitive" as const } },
    ];
  }
  if (Object.keys(priceFilter).length > 0) {
    where.priceCents = priceFilter;
  }

  // ORDER BY
  const orderBy =
    sort === "price_asc"
      ? { priceCents: "asc" as const }
      : sort === "price_desc"
      ? { priceCents: "desc" as const }
      : { createdAt: "desc" as const }; // "newest" default

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy,
      take: PAGE_SIZE,
      skip: (pageNum - 1) * PAGE_SIZE,
      include: {
        photos: { take: 1, orderBy: { sortOrder: "asc" }, select: { url: true } },
        seller: { include: { user: true } },
      },
    }),
    prisma.listing.count({ where }),
  ]);

  // Which are saved by the current user?
  const { userId } = await auth();
  let savedSet = new Set<string>();
  if (userId && listings.length) {
    const me = await prisma.user.findUnique({
      where: { clerkId: userId },
      select: { id: true },
    });
    if (me) {
      const favs = await prisma.favorite.findMany({
        where: { userId: me.id, listingId: { in: listings.map((l) => l.id) } },
        select: { listingId: true },
      });
      savedSet = new Set(favs.map((f) => f.listingId));
    }
  }

  // Paging helpers
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const clampedPage = Math.min(Math.max(pageNum, 1), totalPages);
  const from = total === 0 ? 0 : (clampedPage - 1) * PAGE_SIZE + 1;
  const to = Math.min(total, clampedPage * PAGE_SIZE);

  const buildParams = (overrides: Partial<Search> = {}) => {
    const params = new URLSearchParams();
    if (q) params.set("q", q);
    if (min) params.set("min", min);
    if (max) params.set("max", max);
    if (sort && sort !== "newest") params.set("sort", sort);
    if (overrides.q != null) {
      if (overrides.q) params.set("q", overrides.q);
      else params.delete("q");
    }
    if (overrides.min != null) {
      if (overrides.min) params.set("min", overrides.min);
      else params.delete("min");
    }
    if (overrides.max != null) {
      if (overrides.max) params.set("max", overrides.max);
      else params.delete("max");
    }
    if (overrides.sort != null) {
      if (overrides.sort && overrides.sort !== "newest") params.set("sort", overrides.sort);
      else params.delete("sort");
    }
    if (overrides.page != null) params.set("page", overrides.page);
    return params;
  };

  const makeHref = (n: number) => `/browse?${buildParams({ page: String(n) }).toString()}`;

  const resetHref = (() => {
    const p = new URLSearchParams();
    if (q) p.set("q", q); // keep search but clear price/sort
    return `/browse?${p.toString()}`;
  })();

  return (
    <main className="p-8 max-w-6xl mx-auto">
      {/* Title + count + pager */}
      <header className="mb-6 space-y-4">
        <div className="flex items-end justify-between">
          <div>
            <h1 className="text-2xl font-semibold">Browse</h1>
            {q ? (
              <p className="text-sm text-neutral-500 mt-1">
                Showing <span className="font-medium">{from}-{to}</span> of {total} results for{" "}
                <span className="font-medium">“{q}”</span>
              </p>
            ) : (
              <p className="text-sm text-neutral-500 mt-1">
                Showing <span className="font-medium">{from}-{to}</span> of {total} items
              </p>
            )}
          </div>

          <nav className="flex items-center gap-2 text-sm">
            {clampedPage > 1 ? (
              <Link href={makeHref(clampedPage - 1)} className="rounded border px-3 py-1 hover:bg-neutral-50">
                ← Prev
              </Link>
            ) : (
              <span className="rounded border px-3 py-1 text-neutral-400">← Prev</span>
            )}

            {totalPages > 1 && (
              <span className="px-2 text-neutral-500">
                Page <span className="font-medium">{clampedPage}</span> of {totalPages}
              </span>
            )}

            {clampedPage < totalPages ? (
              <Link href={makeHref(clampedPage + 1)} className="rounded border px-3 py-1 hover:bg-neutral-50">
                Next →
              </Link>
            ) : (
              <span className="rounded border px-3 py-1 text-neutral-400">Next →</span>
            )}
          </nav>
        </div>

        {/* Price + Sort filters (preserve q); safe if left blank */}
        <form method="get" className="flex flex-wrap items-end gap-3">
          {q && <input type="hidden" name="q" value={q} />}

          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-600">Min</label>
            <input
              name="min"
              defaultValue={min}
              inputMode="decimal"
              placeholder="0"
              className="w-24 rounded border px-3 py-1"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-600">Max</label>
            <input
              name="max"
              defaultValue={max}
              inputMode="decimal"
              placeholder="1000"
              className="w-24 rounded border px-3 py-1"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-sm text-neutral-600">Sort</label>
            <select name="sort" defaultValue={sort} className="rounded border px-3 py-1">
              <option value="newest">Newest</option>
              <option value="price_asc">Price: Low to High</option>
              <option value="price_desc">Price: High to Low</option>
            </select>
          </div>

          <button className="rounded border px-3 py-1 hover:bg-neutral-50">Apply</button>
          <Link href={resetHref} className="text-sm underline">
            Reset
          </Link>
        </form>
      </header>

      {/* Grid */}
      <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
        {listings.map((l) => {
          const img = l.photos[0]?.url ?? "/favicon.ico";
          const sellerName = l.seller.displayName ?? l.seller.user?.email ?? "Seller";
          const sellerHref = `/seller/${l.sellerId}`;
          const sellerAvatar = l.seller.user?.imageUrl ?? null;

          const initials =
            (sellerName || "S")
              .split(/\s+/)
              .filter(Boolean)
              .slice(0, 2)
              .map((w) => w[0]?.toUpperCase() ?? "")
              .join("") || "S";

          return (
            <li key={l.id} className="border rounded-xl overflow-hidden">
              {/* Image + heart (not inside the link) */}
              <div className="relative">
                <Link href={`/listing/${l.id}`} className="block">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt={l.title} src={img} className="w-full h-48 object-cover" />
                </Link>
                <div className="absolute top-2 right-2">
                  <FavoriteButton listingId={l.id} initialSaved={savedSet.has(l.id)} />
                </div>
              </div>

              {/* Title/price */}
              <Link href={`/listing/${l.id}`} className="block">
                <div className="p-4 space-y-2">
                  <div className="flex items-baseline justify-between">
                    <div className="font-medium">{l.title}</div>
                    <div className="opacity-70">${(l.priceCents / 100).toFixed(2)}</div>
                  </div>
                </div>
              </Link>

              {/* Seller chip */}
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

      {/* Bottom pager mirrors the top */}
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
    </main>
  );
}







