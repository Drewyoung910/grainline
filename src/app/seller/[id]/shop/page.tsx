// src/app/seller/[id]/shop/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Category } from "@prisma/client";
import FavoriteButton from "@/components/FavoriteButton";
import GuildBadge from "@/components/GuildBadge";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import SortSelect from "./SortSelect";

const PAGE_SIZE = 20;

type ShopSearch = {
  category?: string;
  sort?: string;
  page?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const seller = await prisma.sellerProfile.findUnique({
    where: { id },
    select: { displayName: true },
  });
  if (!seller) return {};
  const name = seller.displayName ?? "Maker";
  return {
    title: { absolute: `${name}'s Shop — Grainline` },
    description: `Browse all handmade woodworking pieces by ${name} on Grainline`,
    alternates: { canonical: `https://grainline.co/seller/${id}/shop` },
  };
}

export default async function SellerShopPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ShopSearch>;
}) {
  const { id } = await params;
  const sp = await searchParams;

  const sort = sp.sort && ["newest", "price_asc", "price_desc", "popular"].includes(sp.sort)
    ? sp.sort
    : "newest";
  const page = Math.max(1, Number(sp.page ?? 1));
  const categoryRaw = sp.category ?? "";
  const category: Category | null = CATEGORY_VALUES.includes(categoryRaw)
    ? (categoryRaw as Category)
    : null;

  const seller = await prisma.sellerProfile.findUnique({
    where: { id },
    select: {
      id: true,
      displayName: true,
      avatarImageUrl: true,
      guildLevel: true,
      user: { select: { imageUrl: true } },
    },
  });

  if (!seller) return notFound();

  // Get current viewer for favorites
  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meId = me?.id ?? null;
  }

  // Distinct categories this seller has active listings in
  const categoryGroups = await prisma.listing.groupBy({
    by: ["category"],
    where: { sellerId: id, status: "ACTIVE", isPrivate: false, category: { not: null } },
    _count: { _all: true },
  });
  const availableCategories = categoryGroups
    .filter((g) => g.category != null)
    .map((g) => g.category as Category)
    .sort();

  // Build where clause
  const where = {
    sellerId: id,
    status: "ACTIVE" as const,
    isPrivate: false,
    ...(category ? { category } : {}),
  };

  // Build orderBy
  type OrderBy =
    | { createdAt: "desc" }
    | { priceCents: "asc" }
    | { priceCents: "desc" }
    | { favorites: { _count: "desc" } };

  const orderBy: OrderBy =
    sort === "price_asc" ? { priceCents: "asc" }
    : sort === "price_desc" ? { priceCents: "desc" }
    : sort === "popular" ? { favorites: { _count: "desc" } }
    : { createdAt: "desc" };

  const [listings, total] = await Promise.all([
    prisma.listing.findMany({
      where,
      orderBy,
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { photos: { orderBy: { sortOrder: "asc" }, take: 1 } },
    }),
    prisma.listing.count({ where }),
  ]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  // Favorites for current viewer
  let savedSet = new Set<string>();
  if (meId && listings.length > 0) {
    const listingIds = listings.map((l) => l.id);
    const favs = await prisma.favorite.findMany({
      where: { userId: meId, listingId: { in: listingIds } },
      select: { listingId: true },
    });
    for (const f of favs) savedSet.add(f.listingId);
  }

  // URL helpers
  function shopUrl(overrides: { category?: string | null; sort?: string; page?: number }) {
    const params = new URLSearchParams();
    const c = "category" in overrides ? overrides.category : categoryRaw;
    const s = overrides.sort ?? sort;
    const p = overrides.page ?? 1;
    if (c) params.set("category", c);
    if (s && s !== "newest") params.set("sort", s);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `/seller/${id}/shop${qs ? `?${qs}` : ""}`;
  }

  const avatarSrc = seller.avatarImageUrl ?? seller.user?.imageUrl ?? null;

  return (
    <main className="max-w-6xl mx-auto px-4 py-6">
      {/* ── Header bar ────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 mb-6 flex-wrap">
        {avatarSrc ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarSrc}
            alt={seller.displayName ?? ""}
            className="h-10 w-10 rounded-full object-cover shrink-0"
          />
        ) : (
          <div className="h-10 w-10 rounded-full bg-neutral-200 shrink-0" />
        )}

        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-xl font-semibold">
              {seller.displayName ? `${seller.displayName}'s Shop` : "Shop"}
            </h1>
            <GuildBadge level={seller.guildLevel} showLabel={true} size={20} />
          </div>
        </div>

        <Link
          href={`/seller/${id}`}
          className="text-sm text-neutral-600 underline shrink-0"
        >
          ← Back to profile
        </Link>
      </div>

      {/* ── Category tabs + sort ────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-5">
        {/* Tabs */}
        <div className="flex overflow-x-auto gap-2 pb-1 flex-1 min-w-0">
          <Link
            href={shopUrl({ category: null, page: 1 })}
            className={`shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
              !category
                ? "bg-neutral-900 text-white border-neutral-900"
                : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
            }`}
          >
            All
          </Link>
          {availableCategories.map((cat) => (
            <Link
              key={cat}
              href={shopUrl({ category: cat, page: 1 })}
              className={`shrink-0 rounded-full border px-3 py-1 text-sm font-medium transition-colors ${
                category === cat
                  ? "bg-neutral-900 text-white border-neutral-900"
                  : "border-neutral-300 text-neutral-700 hover:bg-neutral-50"
              }`}
            >
              {CATEGORY_LABELS[cat] ?? cat}
            </Link>
          ))}
        </div>

        {/* Sort */}
        <SortSelect currentSort={sort} sellerId={id} category={category} />
      </div>

      {/* ── Results count ───────────────────────────────────────────── */}
      <p className="text-sm text-neutral-500 mb-4">
        {total === 0 ? "No pieces" : `${total} ${total === 1 ? "piece" : "pieces"}`}
      </p>

      {/* ── Grid ────────────────────────────────────────────────────── */}
      {listings.length === 0 ? (
        <div className="border border-neutral-200 p-12 text-center text-neutral-500">
          {category
            ? `No pieces in ${CATEGORY_LABELS[category] ?? category} yet.`
            : "No pieces listed yet."}
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {listings.map((l) => {
            const thumb = l.photos[0]?.url ?? null;
            return (
              <li key={l.id} className="relative border border-neutral-200 overflow-hidden hover:shadow-sm transition-shadow">
                <Link href={`/listing/${l.id}`} className="block">
                  <div className="h-48 bg-neutral-100 overflow-hidden">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={thumb}
                        alt={l.title}
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full bg-neutral-200" />
                    )}
                  </div>
                  <div className="p-3 bg-stone-50">
                    <div className="font-medium text-sm line-clamp-2">{l.title}</div>
                    <div className="text-sm text-neutral-500">
                      {(l.priceCents / 100).toLocaleString(undefined, {
                        style: "currency",
                        currency: l.currency,
                      })}
                    </div>
                  </div>
                </Link>
                <FavoriteButton listingId={l.id} initialSaved={savedSet.has(l.id)} />
              </li>
            );
          })}
        </ul>
      )}

      {/* ── Pagination ──────────────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between mt-8 text-sm">
          {page > 1 ? (
            <Link
              href={shopUrl({ page: page - 1 })}
              className="rounded border border-neutral-300 px-4 py-2 hover:bg-neutral-50"
            >
              ← Prev
            </Link>
          ) : (
            <span />
          )}
          <span className="text-neutral-500">
            Page {page} of {totalPages}
          </span>
          {page < totalPages ? (
            <Link
              href={shopUrl({ page: page + 1 })}
              className="rounded border border-neutral-300 px-4 py-2 hover:bg-neutral-50"
            >
              Next →
            </Link>
          ) : (
            <span />
          )}
        </div>
      )}
    </main>
  );
}
