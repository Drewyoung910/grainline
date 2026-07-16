// src/app/account/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ensureUserForPage } from "@/lib/pageAuth";
import type { Metadata } from "next";
import ClickTracker from "@/components/ClickTracker";
import { publicListingPath } from "@/lib/publicPaths";
import { orderTotalCents } from "@/lib/orderTotals";
import { getBlockedSellerProfileIdsFor } from "@/lib/blocks";
import { savedListingFavoriteWhere } from "@/lib/savedListingVisibility";
import { listOwnerSavedSearches } from "@/lib/savedSearchOwnerAccess";
import { formatCurrencyCents, formatCurrencyMinorUnitAmount } from "@/lib/money";
import { blockingRefundLedgerWhere } from "@/lib/refundRouteState";
import { paidStripeOrderWhere } from "@/lib/orderTrust";

export const metadata: Metadata = {
  title: "My Account",
  robots: { index: false, follow: false },
};

export default async function AccountPage() {
  const me = await ensureUserForPage("/account");
  const blockedSellerIds = await getBlockedSellerProfileIdsFor(me.id);

  const [recentOrders, savedItems, savedSearches, followCount, sellerProfile] = await Promise.all([
    // Most recent 5 orders as a buyer
    prisma.order.findMany({
      where: { buyerId: me.id },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 5,
      select: {
        id: true,
        createdAt: true,
        itemsSubtotalCents: true,
        shippingAmountCents: true,
        taxAmountCents: true,
        giftWrappingPriceCents: true,
        currency: true,
        fulfillmentStatus: true,
        items: {
          select: {
            priceCents: true,
            quantity: true,
            listing: {
              select: {
                id: true,
                title: true,
                photos: {
                  take: 1,
                  orderBy: { sortOrder: "asc" },
                  select: { url: true },
                },
              },
            },
          },
        },
      },
    }),

    // Most recent 6 saved (favorited) listings
    prisma.favorite.findMany({
      where: savedListingFavoriteWhere(me.id, blockedSellerIds),
      orderBy: [{ createdAt: "desc" }, { listingId: "desc" }],
      take: 6,
      select: {
        listing: {
          select: {
            id: true,
            title: true,
            priceCents: true,
            currency: true,
            photos: {
              take: 1,
              orderBy: { sortOrder: "asc" },
              select: { url: true },
            },
            seller: {
              select: { displayName: true },
            },
          },
        },
      },
    }),

    listOwnerSavedSearches(me.id, { take: 3 }),

    // Follow count
    prisma.follow.count({ where: { followerId: me.id } }),

    // Seller profile stats (if they're a seller)
    prisma.sellerProfile.findUnique({
      where: { userId: me.id },
      select: {
        id: true,
        onboardingComplete: true,
        _count: {
          select: {
            listings: { where: { status: "ACTIVE" } },
          },
        },
      },
    }),
  ]);

  // Completed order count for sellers
  let completedOrderCount = 0;
  if (sellerProfile) {
    completedOrderCount = await prisma.order.count({
      where: {
        items: {
          some: { listing: { sellerId: sellerProfile.id } },
          every: { listing: { sellerId: sellerProfile.id } },
        },
        ...paidStripeOrderWhere(),
        sellerRefundId: null,
        paymentEvents: { none: blockingRefundLedgerWhere() },
        fulfillmentStatus: { in: ["DELIVERED", "PICKED_UP"] },
      },
    });
  }

  function savedSearchHref(search: (typeof savedSearches)[number]) {
    const params = new URLSearchParams();
    if (search.query) params.set("q", search.query);
    if (search.category) params.set("category", search.category);
    if (search.listingType) params.set("type", search.listingType);
    if (search.shipsWithinDays != null) params.set("ships", String(search.shipsWithinDays));
    if (search.minRating != null) params.set("rating", String(search.minRating));
    if (search.lat != null && search.lng != null && search.radiusMiles != null) {
      params.set("lat", String(search.lat));
      params.set("lng", String(search.lng));
      params.set("radius", String(search.radiusMiles));
    }
    if (search.sort) params.set("sort", search.sort);
    if (search.minPrice != null) params.set("min", formatCurrencyMinorUnitAmount(search.minPrice));
    if (search.maxPrice != null) params.set("max", formatCurrencyMinorUnitAmount(search.maxPrice));
    for (const tag of search.tags) params.append("tag", tag);
    return `/browse?${params.toString()}`;
  }

  function savedSearchLabel(search: (typeof savedSearches)[number]) {
    const parts: string[] = [];
    if (search.query) parts.push(`"${search.query}"`);
    if (search.category) parts.push(search.category.charAt(0) + search.category.slice(1).toLowerCase());
    if (search.listingType) parts.push(search.listingType === "IN_STOCK" ? "In stock" : "Made to order");
    if (search.shipsWithinDays != null) parts.push(`ships within ${search.shipsWithinDays}d`);
    if (search.minRating != null) parts.push(`${search.minRating}★+`);
    if (search.minPrice != null) parts.push(`${formatCurrencyCents(search.minPrice)}+`);
    if (search.maxPrice != null) parts.push(`up to ${formatCurrencyCents(search.maxPrice)}`);
    if (search.lat != null && search.lng != null && search.radiusMiles != null) parts.push(`within ${search.radiusMiles} mi`);
    if (search.tags.length > 0) parts.push(search.tags.map((tag) => `#${tag}`).join(" "));
    return parts.length > 0 ? parts.join(" · ") : "All listings";
  }

  function formatStatus(status: string | null) {
    if (!status) return "Pending";
    switch (status) {
      case "PENDING": return "Processing";
      case "READY_FOR_PICKUP": return "Ready for Pickup";
      case "PICKED_UP": return "Picked Up";
      case "SHIPPED": return "Shipped";
      case "DELIVERED": return "Delivered";
      default: return status;
    }
  }

  function statusColor(status: string | null) {
    switch (status) {
      case "DELIVERED":
      case "PICKED_UP":
        return "bg-green-100 text-green-800";
      case "SHIPPED":
        return "bg-blue-100 text-blue-800";
      case "READY_FOR_PICKUP":
        return "bg-amber-100 text-amber-800";
      default:
        return "bg-neutral-100 text-neutral-700";
    }
  }

  return (
    <main className="max-w-7xl mx-auto p-6 md:p-8 space-y-10">
      {/* ── Header ── */}
      <header className="flex items-center gap-4">
        {me.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={me.imageUrl}
            alt={me.name ?? ""}
            className="h-14 w-14 rounded-full object-cover border"
          />
        )}
        <div>
          <h1 className="text-3xl font-bold font-display">My Account</h1>
          <p className="text-neutral-500 text-sm mt-0.5">{me.email}</p>
        </div>
      </header>

      {/* ── Section 1: Recent Orders ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display">My Orders</h2>
          <Link href="/account/orders" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View all orders →
          </Link>
        </div>

        {recentOrders.length === 0 ? (
          <div className="card-section p-6 text-neutral-600 text-sm space-y-2">
            <p>No orders yet.</p>
            <Link href="/browse" className="underline hover:text-neutral-900">
              Start browsing →
            </Link>
          </div>
        ) : (
          <ul className="card-section divide-y divide-neutral-100">
            {recentOrders.map((order) => {
              const firstItem = order.items[0];
              const thumb = firstItem?.listing.photos[0]?.url;
              const total = orderTotalCents(order);

              return (
                <li key={order.id}>
                  <Link
                    href={`/dashboard/orders/${order.id}`}
                    className="flex items-center gap-4 p-3 transition-colors hover:bg-neutral-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-300"
                  >
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 object-cover" />
                    ) : (
                      <div className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 bg-neutral-100" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">
                        {firstItem?.listing.title ?? "Order"}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {new Date(order.createdAt).toLocaleDateString("en-US")} ·{" "}
                        {formatCurrencyCents(total, order.currency)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusColor(order.fulfillmentStatus)}`}>
                        {formatStatus(order.fulfillmentStatus)}
                      </span>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Section 2: Saved Items ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display">Saved Items</h2>
          <Link href="/account/saved" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View all saved →
          </Link>
        </div>

        {savedItems.length === 0 ? (
          <div className="card-section p-6 text-neutral-600 text-sm">
            No saved items yet. Heart pieces while browsing to save them here.
          </div>
        ) : (
          <ul className="flex gap-4 overflow-x-auto pb-0 bg-white">
            {savedItems.map(({ listing }) => {
              const thumb = listing.photos[0]?.url;
              return (
                <ClickTracker key={listing.id} listingId={listing.id} className="card-listing shrink-0 w-40 transition-colors">
                  <Link href={publicListingPath(listing.id, listing.title)} className="block">
                    {thumb ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={thumb} alt={listing.title} className="h-32 w-full object-cover" />
                    ) : (
                      <div className="h-32 w-full bg-neutral-100" />
                    )}
                    <div className="p-2 bg-white border-t border-neutral-100">
                      <p className="text-xs font-medium truncate">{listing.title}</p>
                      <p className="text-xs text-neutral-500">
                        {formatCurrencyCents(listing.priceCents, listing.currency)}
                      </p>
                    </div>
                  </Link>
                </ClickTracker>
              );
            })}
          </ul>
        )}
      </section>

      {/* ── Section 3: Saved Searches ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display">Saved Searches</h2>
          <Link href="/account/saved-searches" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            Manage saved searches →
          </Link>
        </div>
        {savedSearches.length === 0 ? (
          <div className="card-section p-6 text-sm text-neutral-600">
            No saved searches yet. Save useful filters from Browse to come back to them quickly.
          </div>
        ) : (
          <ul className="card-section divide-y divide-neutral-100">
            {savedSearches.map((search) => (
              <li key={search.id} className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <Link href={savedSearchHref(search)} className="text-sm font-medium text-neutral-900 hover:underline">
                    {savedSearchLabel(search)}
                  </Link>
                  <p className="mt-0.5 text-xs text-neutral-500">
                    Saved {search.createdAt.toLocaleDateString("en-US")}
                  </p>
                </div>
                <Link
                  href={savedSearchHref(search)}
                  className="inline-flex min-h-[34px] w-fit items-center rounded-md border border-neutral-200 bg-white px-3 py-1 text-xs font-medium text-neutral-700 transition-colors hover:bg-neutral-50"
                >
                  Browse
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Section 3: Following ── */}
      <section>
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-semibold font-display">Following</h2>
          <Link href="/account/feed" className="text-sm text-neutral-600 underline hover:text-neutral-900">
            View feed →
          </Link>
        </div>
        <div className="card-section p-5 flex items-center justify-between">
          <div>
            <p className="text-2xl font-bold">{followCount}</p>
            <p className="text-xs text-neutral-500">maker{followCount !== 1 ? "s" : ""} followed</p>
          </div>
          <Link
            href="/account/following"
            className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
          >
            Manage →
          </Link>
        </div>
      </section>

      {/* ── Section 4: My Reviews ── */}
      <section>
        <h2 className="text-xl font-semibold font-display mb-4">My Reviews</h2>
        <div className="card-section p-4 space-y-2">
          <p className="text-sm text-neutral-700 mb-1">Reviews you&apos;ve written for items you&apos;ve purchased</p>
          <Link href="/account/reviews" className="text-sm underline hover:text-neutral-900 block">
            View my reviews →
          </Link>
        </div>
      </section>

      {/* ── Section 5 (orig 4): Commission Requests ── */}
      <section>
        <h2 className="text-xl font-semibold font-display mb-4">Commission Requests</h2>
        <div className="card-section p-4">
          <p className="text-sm text-neutral-500 mb-3">Custom pieces you&apos;ve requested from makers</p>
          <div className="flex flex-wrap items-center gap-2">
            <Link href="/account/commissions" className="text-sm underline hover:text-neutral-900">
              View my commission requests →
            </Link>
            <span className="text-sm text-neutral-500">or</span>
            <Link href="/commission" className="text-sm underline hover:text-neutral-900">
              Browse the Commission Room →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section 5: Account Settings ── */}
      <section>
        <h2 className="text-xl font-semibold font-display mb-4">Account Settings</h2>
        <div className="card-section p-5 space-y-3">
          <div className="text-sm space-y-1">
            <p className="font-medium">{me.name ?? "—"}</p>
            <p className="text-neutral-500">{me.email}</p>
          </div>
          <p className="text-xs text-neutral-500">
            Update your name, email, and password through your account settings.
          </p>
          <div className="flex flex-col items-start gap-2">
            <Link href="/account/settings" className="text-sm underline text-neutral-600 hover:text-neutral-900">
              Account settings →
            </Link>
            <Link href="/account/blocked" className="text-sm underline text-neutral-600 hover:text-neutral-900">
              Blocked users →
            </Link>
          </div>
        </div>
      </section>

      {/* ── Section 6: Workshop (sellers only) ── */}
      {sellerProfile && (
        <section>
          <h2 className="text-xl font-semibold font-display mb-4">Your Workshop</h2>
          <div className="card-section p-5 space-y-4">
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-2xl font-bold">{sellerProfile._count.listings}</p>
                <p className="text-neutral-500 text-xs">Active listings</p>
              </div>
              <div>
                <p className="text-2xl font-bold">{completedOrderCount}</p>
                <p className="text-neutral-500 text-xs">Completed orders</p>
              </div>
            </div>
            <div className="flex gap-3 flex-wrap">
              <Link
                href="/dashboard"
                className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-neutral-800"
              >
                Go to Workshop →
              </Link>
              <Link
                href="/dashboard/blog"
                className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
              >
                My Blog Posts
              </Link>
              <Link
                href="/dashboard/blog/new"
                className="inline-flex min-h-[40px] items-center rounded-md border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50"
              >
                Write a Post
              </Link>
            </div>
          </div>
        </section>
      )}
      {!sellerProfile && (
        <section>
          <h2 className="text-xl font-semibold font-display mb-4">Sell on Grainline</h2>
          <div className="card-section p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Open your maker workshop</p>
              <p className="mt-1 text-sm text-neutral-500">
                Create a seller profile, connect Stripe, and start listing handmade woodworking.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="inline-flex shrink-0 items-center justify-center rounded-md border border-neutral-900 bg-neutral-900 px-4 py-2 text-sm font-medium text-white hover:bg-neutral-800 transition-colors"
            >
              Become a Maker →
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
