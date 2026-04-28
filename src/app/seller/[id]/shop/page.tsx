// src/app/seller/[id]/shop/page.tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { Category } from "@prisma/client";
import ClickTracker from "@/components/ClickTracker";
import ListingCard from "@/components/ListingCard";
import GuildBadge from "@/components/GuildBadge";
import FollowButton from "@/components/FollowButton";
import ShopListingActions from "./ShopListingActions";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";
import SortSelect from "./SortSelect";
import { publicListingWhere } from "@/lib/listingVisibility";
import { extractRouteId, publicListingPath, publicSellerPath, publicSellerShopPath } from "@/lib/publicPaths";

const PAGE_SIZE = 20;

const STATUS_TABS = [
  { value: "", label: "All" },
  { value: "ACTIVE", label: "Active" },
  { value: "DRAFT", label: "Draft" },
  { value: "HIDDEN", label: "Hidden" },
  { value: "SOLD_OUT", label: "Sold Out" },
  { value: "SOLD", label: "Sold" },
  { value: "PENDING_REVIEW", label: "Under Review" },
  { value: "REJECTED", label: "Rejected" },
] as const;

type ShopSearch = {
  category?: string;
  sort?: string;
  page?: string;
  status?: string;
};

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const sellerId = extractRouteId(id);
  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: {
      displayName: true,
      chargesEnabled: true,
      vacationMode: true,
      user: { select: { banned: true, deletedAt: true } },
    },
  });
  if (!seller) return {};
  if (!seller.chargesEnabled || seller.vacationMode || seller.user?.banned || seller.user?.deletedAt) {
    return { robots: { index: false, follow: false } };
  }
  const name = seller.displayName ?? "Maker";
  return {
    title: { absolute: `${name}'s Shop — Grainline` },
    description: `Browse all handmade woodworking pieces by ${name} on Grainline`,
    alternates: { canonical: `https://thegrainline.com${publicSellerShopPath(sellerId, name)}` },
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
  const sellerId = extractRouteId(id);
  const sp = await searchParams;

  const sort = sp.sort && ["newest", "price_asc", "price_desc", "popular"].includes(sp.sort)
    ? sp.sort
    : "newest";
  const page = Math.max(1, Number(sp.page ?? 1));
  const categoryRaw = sp.category ?? "";
  const category: Category | null = CATEGORY_VALUES.includes(categoryRaw)
    ? (categoryRaw as Category)
    : null;
  const statusRaw = sp.status ?? "";

  const seller = await prisma.sellerProfile.findUnique({
    where: { id: sellerId },
    select: {
      id: true,
      userId: true,
      displayName: true,
      avatarImageUrl: true,
      guildLevel: true,
      city: true,
      state: true,
      acceptingNewOrders: true,
      chargesEnabled: true,
      vacationMode: true,
      vacationReturnDate: true,
      vacationMessage: true,
      user: { select: { imageUrl: true, clerkId: true, banned: true, deletedAt: true } },
    },
  });

  if (!seller) return notFound();
  const sellerShopHref = publicSellerShopPath(seller.id, seller.displayName);

  // Get current viewer for favorites
  const { userId } = await auth();
  let meId: string | null = null;
  if (userId) {
    const me = await prisma.user.findUnique({ where: { clerkId: userId }, select: { id: true } });
    meId = me?.id ?? null;
  }

  const isOwner = !!userId && seller.user?.clerkId === userId;
  if (!isOwner && (!seller.chargesEnabled || seller.user?.banned || seller.user?.deletedAt)) {
    return notFound();
  }

  // Follow data
  const [followerCount, isFollowing] = await Promise.all([
    prisma.follow.count({ where: { sellerProfileId: sellerId } }),
    meId
      ? prisma.follow.findUnique({
          where: { followerId_sellerProfileId: { followerId: meId, sellerProfileId: sellerId } },
          select: { id: true },
        }).then((r) => r !== null)
      : Promise.resolve(false),
  ]);

  // Validate status filter (owner only)
  const validStatuses = STATUS_TABS.map((t) => t.value).filter(Boolean);
  const statusFilter = isOwner && validStatuses.includes(statusRaw as typeof validStatuses[number])
    ? statusRaw
    : "";

  // Distinct categories — for owner show all statuses (optionally filtered by status), for buyers show ACTIVE only
  const categoryGroupWhere = isOwner
    ? {
        sellerId,
        category: { not: null },
        ...(statusFilter ? { status: statusFilter as "ACTIVE" | "DRAFT" | "HIDDEN" | "SOLD" | "SOLD_OUT" | "PENDING_REVIEW" | "REJECTED" } : {}),
      }
    : publicListingWhere({ sellerId, category: { not: null } });

  const categoryGroups = await prisma.listing.groupBy({
    by: ["category"],
    where: categoryGroupWhere,
    _count: { _all: true },
  });
  const availableCategories = categoryGroups
    .filter((g) => g.category != null)
    .map((g) => g.category as Category)
    .sort();

  // Build where clause — owner sees all listings (filtered by status); buyers see ACTIVE + chargesEnabled only
  const categoryFilter = category ? { category } : {};
  const ownerStatusFilter = statusFilter
    ? { status: statusFilter as "ACTIVE" | "DRAFT" | "HIDDEN" | "SOLD" | "SOLD_OUT" | "PENDING_REVIEW" | "REJECTED" }
    : {};
  const where = isOwner
    ? { sellerId, ...ownerStatusFilter, ...categoryFilter }
    : publicListingWhere({ sellerId, ...categoryFilter });

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
  const savedSet = new Set<string>();
  if (meId && listings.length > 0) {
    const listingIds = listings.map((l) => l.id);
    const favs = await prisma.favorite.findMany({
      where: { userId: meId, listingId: { in: listingIds } },
      select: { listingId: true },
    });
    for (const f of favs) savedSet.add(f.listingId);
  }

  // URL helpers
  function shopUrl(overrides: { category?: string | null; sort?: string; page?: number; status?: string | null }) {
    const params = new URLSearchParams();
    const c = "category" in overrides ? overrides.category : categoryRaw;
    const s = overrides.sort ?? sort;
    const p = overrides.page ?? 1;
    const st = "status" in overrides ? overrides.status : statusFilter;
    if (c) params.set("category", c);
    if (s && s !== "newest") params.set("sort", s);
    if (p > 1) params.set("page", String(p));
    if (st) params.set("status", st);
    const qs = params.toString();
    return `${sellerShopHref}${qs ? `?${qs}` : ""}`;
  }

  const avatarSrc = seller.avatarImageUrl ?? seller.user?.imageUrl ?? null;

  return (
    <main className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6">
      {/* ── Vacation notice ──────────────────────────────────────────── */}
      {seller.vacationMode && (
        <div className="mb-6 border border-amber-300 bg-amber-50 px-5 py-4">
          <p className="font-medium text-amber-900">This maker is currently on vacation and not accepting new orders.</p>
          {seller.vacationReturnDate && (
            <p className="text-amber-800 text-sm mt-0.5">
              Expected return: {new Date(seller.vacationReturnDate).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}
            </p>
          )}
          {seller.vacationMessage && (
            <p className="text-amber-800 text-sm mt-0.5">{seller.vacationMessage}</p>
          )}
          <Link href="/browse" className="inline-block mt-2 text-sm text-amber-900 underline hover:text-amber-700">
            Browse other makers →
          </Link>
        </div>
      )}

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
            <GuildBadge level={seller.guildLevel} showLabel={true} size={36} />
          </div>
          {meId !== seller.userId && (
            <div className="mt-1">
              <FollowButton
                sellerProfileId={seller.id}
                sellerUserId={seller.userId}
                initialFollowing={isFollowing}
                initialCount={followerCount}
                size="sm"
              />
            </div>
          )}
        </div>

        <Link
          href={publicSellerPath(seller.id, seller.displayName)}
          className="text-sm text-neutral-600 underline shrink-0"
        >
          ← Back to profile
        </Link>
      </div>

      {/* ── Category tabs + sort ────────────────────────────────────── */}
      <div className="flex items-start justify-between gap-4 mb-3">
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
        <SortSelect currentSort={sort} sellerId={seller.id} sellerName={seller.displayName} category={category} />
      </div>

      {/* ── Status tabs (owner only) ────────────────────────────────── */}
      {isOwner && (
        <div className="flex overflow-x-auto gap-2 pb-1 mb-5">
          {STATUS_TABS.map((tab) => (
            <Link
              key={tab.value}
              href={shopUrl({ status: tab.value || null, page: 1 })}
              className={`shrink-0 rounded-full border px-3 py-0.5 text-xs font-medium transition-colors ${
                statusFilter === tab.value
                  ? "bg-neutral-700 text-white border-neutral-700"
                  : "border-neutral-300 text-neutral-600 hover:bg-neutral-50"
              }`}
            >
              {tab.label}
            </Link>
          ))}
        </div>
      )}

      {/* ── Results count ───────────────────────────────────────────── */}
      <p className="text-sm text-neutral-500 mb-4">
        {total === 0 ? "No pieces" : `${total} ${total === 1 ? "piece" : "pieces"}`}
      </p>

      {/* ── Grid ────────────────────────────────────────────────────── */}
      {listings.length === 0 ? (
        <div className="border border-neutral-200 p-12 text-center text-neutral-500">
          {isOwner && statusFilter ? (
            <div>
              <p>{`No ${STATUS_TABS.find((t) => t.value === statusFilter)?.label.toLowerCase() ?? ""} listings.`}</p>
              <Link href={shopUrl({ status: null, page: 1 })} className="mt-2 inline-block text-sm text-neutral-700 underline hover:text-neutral-900">
                View all listings
              </Link>
            </div>
          ) : isOwner && !category ? (
            <div>
              <p>{"Your workshop is empty — list your first piece and start selling."}</p>
              <Link href="/dashboard/listings/new" className="mt-2 inline-block text-sm text-neutral-700 underline hover:text-neutral-900">
                Create a listing →
              </Link>
            </div>
          ) : category ? (
            `No pieces in ${CATEGORY_LABELS[category] ?? category} yet.`
          ) : (
            "No pieces listed yet."
          )}
        </div>
      ) : (
        <ul className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {listings.map((l) => {
            const isArchived = l.status === "HIDDEN" && l.isPrivate;
            const statusBadge =
              l.status === "DRAFT" ? { label: "Draft", cls: "bg-neutral-100 text-neutral-600" }
              : isArchived ? { label: "Archived", cls: "bg-neutral-100 text-neutral-600" }
              : l.status === "HIDDEN" ? { label: "Hidden", cls: "bg-neutral-100 text-neutral-600" }
              : l.status === "PENDING_REVIEW" ? { label: "Under Review", cls: "bg-amber-50 text-amber-700 border border-amber-200" }
              : l.status === "REJECTED" ? { label: "Rejected", cls: "bg-red-50 text-red-700 border border-red-200" }
              : l.status === "SOLD" ? { label: "Sold", cls: "bg-neutral-100 text-neutral-500" }
              : l.status === "SOLD_OUT" ? { label: "Sold Out", cls: "bg-neutral-100 text-neutral-500" }
              : null;
            return (
              <ClickTracker key={l.id} listingId={l.id}>
                <div className="relative">
                  <ListingCard
                    listing={{
                      id: l.id,
                      title: l.title,
                      priceCents: l.priceCents,
                      currency: l.currency,
                      status: l.status,
                      listingType: l.listingType,
                      stockQuantity: l.stockQuantity ?? null,
                      photoUrl: l.photos[0]?.url ?? null,
                      seller: {
                        id: seller.id,
                        displayName: seller.displayName ?? null,
                        avatarImageUrl: seller.avatarImageUrl ?? seller.user?.imageUrl ?? null,
                        guildLevel: seller.guildLevel ?? null,
                        city: seller.city ?? null,
                        state: seller.state ?? null,
                        acceptingNewOrders: seller.acceptingNewOrders ?? null,
                      },
                      rating: null,
                    }}
                    initialSaved={savedSet.has(l.id)}
                    variant="grid"
                    href={
                      isOwner && isArchived
                        ? null
                        : isOwner && l.status === "DRAFT"
                          ? `${publicListingPath(l.id, l.title)}?preview=1`
                          : undefined
                    }
                  />
                  {isOwner ? (
                    <div>
                      {statusBadge && (
                        <div className="mt-1 px-0.5">
                          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${statusBadge.cls}`}>
                            {statusBadge.label}
                          </span>
                        </div>
                      )}
                      <ShopListingActions listingId={l.id} status={l.status} isPrivate={l.isPrivate} />
                    </div>
                  ) : null}
                </div>
              </ClickTracker>
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
