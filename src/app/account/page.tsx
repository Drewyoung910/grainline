// src/app/account/page.tsx
import Link from "next/link";
import { prisma } from "@/lib/db";
import { ensureUserForPage } from "@/lib/pageAuth";
import type { Metadata } from "next";
import ClickTracker from "@/components/ClickTracker";
import { publicListingPath } from "@/lib/publicPaths";
import { orderTotalCents } from "@/lib/orderTotals";
import {
  orderPaymentPresentationLabel,
  orderPaymentPresentationState,
  suppressActiveFulfillmentForPaymentState,
} from "@/lib/orderPaymentPresentation";
import { listOwnerSavedSearches } from "@/lib/savedSearchOwnerAccess";
import { sellerOwnerSavedListingPage } from "@/lib/sellerSavedListingAccess";
import { formatCurrencyCents, formatCurrencyMinorUnitAmount } from "@/lib/money";
import { countSellerCompletedOrders } from "@/lib/orderSellerAnalyticsAuthority";
import { readBuyerOrderSummaryPage } from "@/lib/orderParticipantReadAuthority";
import { sellerOwnerAccountSummary } from "@/lib/sellerProfileOwnerAccess";
import { Suspense } from "react";
import { AccountOverviewSkeleton } from "@/components/RouteSkeletons";
import ScrollFadeRow from "@/components/ScrollFadeRow";
import { ownerRawFollowCount } from "@/lib/sellerFollowAccess";
import { ChevronRight } from "@/components/icons";
import { activeOrder, orderProgressFraction, orderProgressSteps } from "@/lib/orderProgress";

export const metadata: Metadata = {
  title: "My Account",
  robots: { index: false, follow: false },
};

export default function AccountPage() {
  return (
    <Suspense fallback={<AccountOverviewSkeleton />}>
      <AccountPageContent />
    </Suspense>
  );
}

async function AccountPageContent() {
  const me = await ensureUserForPage("/account");

  const [recentOrderPage, savedItems, savedSearches, followCount, sellerProfile] = await Promise.all([
    // Most recent 5 orders as a buyer
    readBuyerOrderSummaryPage({ actorUserId: me.id, limit: 5 }),

    // Most recent 6 saved (favorited) listings
    sellerOwnerSavedListingPage(me.id, 6, 0),

    listOwnerSavedSearches(me.id, prisma, { take: 3 }),

    // Follow count
    ownerRawFollowCount(me.id),

    // Seller profile stats (if they're a seller)
    sellerOwnerAccountSummary(me.id),
  ]);
  const recentOrders = recentOrderPage.rows;

  // The newest order still on its way gets the progress line at the top.
  const onItsWay = activeOrder(recentOrders, (order) =>
    suppressActiveFulfillmentForPaymentState(
      orderPaymentPresentationState({
        paid: order.paidAt != null,
        orderTotalCents: orderTotalCents(order),
        refundAmountCents: order.sellerRefundAmountCents,
        refundRecorded: order.sellerRefundAmountCents != null,
      }),
      order.fulfillmentStatus,
    ),
  );
  const onItsWaySteps = onItsWay ? orderProgressSteps(onItsWay) : [];

  // Completed order count for sellers
  let completedOrderCount = 0;
  if (sellerProfile) {
    completedOrderCount = await countSellerCompletedOrders(me.id);
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
    <main className="mx-auto max-w-5xl space-y-7">
      <header>
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(2rem,3.4vw,2.875rem)] leading-[1.04]">My Account</h1>
          <p className="mt-2 break-all text-neutral-500">{me.email}</p>
        </div>
      </header>

      {onItsWay && (
        <section aria-labelledby="account-active-order-title" className="card-section p-5 sm:p-[22px]">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[12.5px] font-semibold uppercase tracking-[0.08em] text-neutral-500">On its way</p>
              <h2 id="account-active-order-title" className="mt-1.5 font-display text-[26px] leading-tight">
                {onItsWay.items[0]?.title ?? "Your order"}
              </h2>
              <p className="mt-1 text-sm text-neutral-500">
                {onItsWay.items[0]?.sellerName ? `${onItsWay.items[0].sellerName} · ` : ""}Order #{onItsWay.id.slice(-8)}
                {onItsWay.labelCarrier && onItsWay.labelTrackingNumber
                  ? ` · ${onItsWay.labelCarrier} ${onItsWay.labelTrackingNumber}`
                  : ""}
              </p>
            </div>
            <Link href={`/dashboard/orders/${onItsWay.id}`} className="btn btn-primary btn-sm">
              View order
            </Link>
          </div>
          <ol
            aria-label="Order progress"
            className="relative mt-5 grid grid-cols-4"
          >
            <span aria-hidden="true" className="absolute left-[12.5%] right-[12.5%] top-2.5 h-0.5 bg-[#EFEAE0]" />
            <span
              aria-hidden="true"
              className="absolute left-[12.5%] top-2.5 h-0.5 bg-[#2C1F1A]"
              style={{ width: `${orderProgressFraction(onItsWaySteps) * 75}%` }}
            />
            {onItsWaySteps.map((step) => (
              <li
                key={step.label}
                aria-current={step.state === "current" ? "step" : undefined}
                className={`relative grid justify-items-center gap-2 text-center text-[13px] ${step.state === "upcoming" ? "text-neutral-500" : "font-medium text-neutral-900"}`}
              >
                <span
                  aria-hidden="true"
                  className={`flex size-[22px] items-center justify-center rounded-full ${
                    step.state === "done"
                      ? "bg-[#2C1F1A]"
                      : step.state === "current"
                        ? "bg-white shadow-[inset_0_0_0_2px_#2C1F1A]"
                        : "bg-white shadow-[inset_0_0_0_2px_#D6CFC2]"
                  }`}
                >
                  {step.state === "done" && (
                    <svg viewBox="0 0 24 24" fill="none" stroke="#FBF8F3" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="size-3"><path d="M5 12.5 10 17 19 7" /></svg>
                  )}
                </span>
                {step.label}
              </li>
            ))}
          </ol>
        </section>
      )}

      {/* ── Section 1: Recent Orders ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[26px] leading-tight">Recent orders</h2>
          <Link href="/account/orders" className="group inline-flex items-center gap-1 text-sm font-medium text-neutral-800 underline-offset-4 hover:underline">
            All orders
            <ChevronRight size={14} className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" />
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
              const thumb = firstItem?.imageUrl;
              const total = orderTotalCents(order);
              // Same refund-aware label as /account/orders, from the summary's
              // locally recorded refund (no provider-outcome read on this page).
              const paymentState = orderPaymentPresentationState({
                paid: order.paidAt != null,
                orderTotalCents: total,
                refundAmountCents: order.sellerRefundAmountCents,
                refundRecorded: order.sellerRefundAmountCents != null,
              });
              const suppressActiveFulfillment = suppressActiveFulfillmentForPaymentState(
                paymentState,
                order.fulfillmentStatus,
              );

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
                        {firstItem?.title ?? "Order"}
                      </p>
                      <p className="mt-0.5 text-xs text-neutral-500">
                        {new Date(order.createdAt).toLocaleDateString("en-US")} ·{" "}
                        {formatCurrencyCents(total, order.currency)}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        suppressActiveFulfillment
                          ? "bg-green-100 text-green-800"
                          : statusColor(order.fulfillmentStatus)
                      }`}>
                        {suppressActiveFulfillment
                          ? orderPaymentPresentationLabel(paymentState)
                          : formatStatus(order.fulfillmentStatus)}
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
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[26px] leading-tight">Saved items</h2>
          <Link href="/account/saved" className="group inline-flex items-center gap-1 text-sm font-medium text-neutral-800 underline-offset-4 hover:underline">
            All saved
            <ChevronRight size={14} className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        </div>

        {savedItems.length === 0 ? (
          <div className="card-section p-6 text-neutral-600 text-sm">
            No saved items yet. Heart pieces while browsing to save them here.
          </div>
        ) : (
          <ScrollFadeRow className="-mx-1 overflow-x-auto px-1">
            <ul className="flex snap-x snap-mandatory gap-4 pb-0" style={{ width: "max-content" }}>
              {savedItems.map(({ listing }) => {
                const thumb = listing.photos[0]?.url;
                return (
                  <ClickTracker key={listing.id} listingId={listing.id} className="w-40 shrink-0 snap-start">
                    <Link
                      href={publicListingPath(listing.id, listing.title)}
                      className="block rounded-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-neutral-900/25 focus-visible:ring-offset-2"
                    >
                      <div className="group/photo aspect-[4/3] w-full overflow-hidden rounded-lg bg-[#EFEAE0]">
                        {thumb ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={thumb}
                            alt={listing.title}
                            className="h-full w-full object-cover transition-transform duration-300 group-hover/photo:scale-105"
                          />
                        ) : null}
                      </div>
                      <div className="mt-2 space-y-0.5 px-0.5">
                        <p className="truncate text-sm font-medium text-neutral-900">{listing.title}</p>
                        <p className="text-sm text-neutral-500">
                          {formatCurrencyCents(listing.priceCents, listing.currency)}
                        </p>
                      </div>
                    </Link>
                  </ClickTracker>
                );
              })}
            </ul>
          </ScrollFadeRow>
        )}
      </section>

      {/* ── Section 3: Saved Searches ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[26px] leading-tight">Saved searches</h2>
          <Link href="/account/saved-searches" className="group inline-flex items-center gap-1 text-sm font-medium text-neutral-800 underline-offset-4 hover:underline">
            Manage
            <ChevronRight size={14} className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" />
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
                  className="btn btn-sm btn-secondary w-fit"
                >
                  Browse
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── Following ── */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-[26px] leading-tight">Following</h2>
          <Link href="/account/feed" className="group inline-flex items-center gap-1 text-sm font-medium text-neutral-800 underline-offset-4 hover:underline">
            Your feed
            <ChevronRight size={14} className="transition-transform duration-300 group-hover:translate-x-0.5 motion-reduce:transition-none" />
          </Link>
        </div>
        <div className="card-section flex items-center justify-between p-5">
          <p className="text-sm text-neutral-600">
            <span className="mr-1.5 text-2xl font-medium tabular-nums text-neutral-900">{followCount}</span>
            maker{followCount !== 1 ? "s" : ""} followed
          </p>
          <Link href="/account/following" className="btn btn-sm btn-secondary">Manage</Link>
        </div>
      </section>

      {/* ── Section 6: Workshop (sellers only) ── */}
      {sellerProfile && (
        <section>
          <h2 className="mb-3 font-display text-[26px] leading-tight">Your workshop</h2>
          <div className="card-section p-5 space-y-4">
            <div className="flex gap-6 text-sm">
              <div>
                <p className="text-2xl font-bold">{sellerProfile.activeListingCount}</p>
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
                className="btn btn-sm btn-primary"
              >
                Go to Workshop →
              </Link>
              <Link
                href="/dashboard/blog"
                className="btn btn-sm btn-secondary"
              >
                My Blog Posts
              </Link>
              <Link
                href="/dashboard/blog/new"
                className="btn btn-sm btn-secondary"
              >
                Write a Post
              </Link>
            </div>
          </div>
        </section>
      )}
      {!sellerProfile && (
        <section>
          <h2 className="mb-3 font-display text-[26px] leading-tight">Sell on Grainline</h2>
          <div className="card-section p-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">Open your maker workshop</p>
              <p className="mt-1 text-sm text-neutral-500">
                Create a seller profile, connect Stripe, and start listing handmade woodworking.
              </p>
            </div>
            <Link
              href="/dashboard"
              className="btn btn-sm btn-primary shrink-0"
            >
              Become a Maker →
            </Link>
          </div>
        </section>
      )}
    </main>
  );
}
