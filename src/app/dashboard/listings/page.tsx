// src/app/dashboard/listings/page.tsx
import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { ListingStatus } from "@prisma/client";
import DismissibleBanner from "@/components/DismissibleBanner";
import InlineActionButton from "@/components/InlineActionButton";
import InventoryQuantityControl from "@/components/InventoryQuantityControl";
import MediaImage from "@/components/MediaImage";
import ResubmitButton from "@/components/ResubmitButton";
import SegmentedControl from "@/components/SegmentedControl";
import { Bell, Eye, Heart, MousePointer } from "@/components/icons";
import { ensureSeller } from "@/lib/ensureSeller";
import { formatCurrencyCents } from "@/lib/money";
import { publicListingPath, publicSellerShopPath } from "@/lib/publicPaths";
import { parseBoundedPositiveIntParam } from "@/lib/queryParams";
import { sellerStockNotificationCounts } from "@/lib/stockNotificationAccess";
import {
  readWorkshopListingFilterCounts,
  readWorkshopListingsPage,
  WORKSHOP_LISTINGS_PAGE_SIZE,
} from "@/lib/workshopData";
import {
  parseWorkshopListingFilter,
  WORKSHOP_LISTING_FILTERS,
  workshopListingFilterCounts,
} from "@/lib/workshopQueue";
import { deleteListing, setStatus, withdrawListingReview } from "./actions";

export const metadata: Metadata = { robots: { index: false, follow: false } };

const DASHBOARD_ACTION_CLASS = "btn btn-secondary btn-sm";
const DASHBOARD_WARNING_ACTION_CLASS = "btn btn-warning btn-sm";
const DASHBOARD_DANGER_ACTION_CLASS = "btn btn-danger btn-sm";

const STATUS_PILLS: Partial<Record<ListingStatus, { label: string; className: string }>> = {
  ACTIVE: { label: "Active", className: "bg-green-100 text-green-800" },
  PENDING_REVIEW: { label: "Under review", className: "bg-amber-100 text-amber-800" },
  REJECTED: { label: "Sent back", className: "bg-red-100 text-red-800" },
  DRAFT: { label: "Draft", className: "bg-[#EFEAE0] text-neutral-700" },
  HIDDEN: { label: "Hidden", className: "bg-[#EFEAE0] text-neutral-700" },
  SOLD_OUT: { label: "Sold out", className: "bg-red-100 text-red-800" },
  SOLD: { label: "Sold", className: "bg-[#EFEAE0] text-neutral-700" },
};

type ListingsPageProps = {
  searchParams?: Promise<{ status?: string | string[]; page?: string | string[] }>;
};

export default async function WorkshopListingsPage({ searchParams }: ListingsPageProps) {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in?redirect_url=/dashboard/listings");
  const params = searchParams ? await searchParams : {};
  const filter = parseWorkshopListingFilter(params.status);

  const { me, seller } = await ensureSeller();

  const { statusCounts, inStock } = await readWorkshopListingFilterCounts(seller.id);
  const filterCounts = workshopListingFilterCounts(statusCounts, inStock);
  const total = filterCounts[filter];
  const totalPages = Math.max(1, Math.ceil(total / WORKSHOP_LISTINGS_PAGE_SIZE));
  const requestedPage = parseBoundedPositiveIntParam(
    typeof params.page === "string" ? params.page : undefined,
    1,
    10_000,
  );
  const page = Math.min(requestedPage, totalPages);

  const listingRows = await readWorkshopListingsPage(seller.id, filter, page);
  const stockNotificationCounts = await sellerStockNotificationCounts(
    me.id,
    listingRows.map((listing) => listing.id),
  );
  const listings = listingRows.map((listing) => ({
    ...listing,
    _count: {
      favorites: listing.favoriteCount,
      stockNotifications: stockNotificationCounts.get(listing.id) ?? 0,
    },
  }));

  const hrefFor = (status: string, pageNumber = 1) => {
    const query = new URLSearchParams();
    if (status !== "all") query.set("status", status);
    if (pageNumber > 1) query.set("page", String(pageNumber));
    const text = query.toString();
    return text ? `/dashboard/listings?${text}` : "/dashboard/listings";
  };

  // Tabs with nothing in them only add noise, but the chosen one always stays.
  const visibleFilters = WORKSHOP_LISTING_FILTERS.filter(
    (option) => option.value === "all" || option.value === filter || filterCounts[option.value] > 0,
  );

  return (
    <main className="mx-auto max-w-5xl space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-display text-[clamp(2rem,3.4vw,2.875rem)] leading-[1.04]">Listings</h1>
          <p className="mt-2 text-neutral-500">Your pieces, their stock and their status.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={publicSellerShopPath(seller.id, seller.displayName)} className="btn btn-secondary btn-sm">
            View My Shop
          </Link>
          <Link href="/dashboard/listings/new" className="btn btn-primary btn-sm">
            New listing
          </Link>
        </div>
      </header>

      {filterCounts.all > 0 && (
        <div className="-mx-4 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 [&::-webkit-scrollbar]:hidden">
          <SegmentedControl
            label="Filter listings"
            size="sm"
            value={filter}
            resetKey={`${filter}:${page}`}
            options={visibleFilters.map((option) => ({
              value: option.value,
              label: `${option.label} ${filterCounts[option.value]}`,
              href: hrefFor(option.value),
            }))}
          />
        </div>
      )}

      {filterCounts.review > 0 && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <span className="font-medium">Some listings are under review.</span>{" "}Our team will approve them shortly. You&apos;ll be notified when they go live.
        </div>
      )}

      {listings.some((l) => l.status === "REJECTED") && (
        <DismissibleBanner
          className="rounded-md border border-red-200 bg-red-50 px-4 py-3 pr-8 text-sm text-red-900"
          rejectedIds={listings.filter((l) => l.status === "REJECTED").map((l) => l.id)}
        >
          <span className="font-medium">Some listings were rejected.</span> Edit and resubmit them for review.
        </DismissibleBanner>
      )}

      {listings.length === 0 ? (
        <div className="card-section p-8 text-neutral-600">
          {filterCounts.all === 0 ? (
            <>Your workshop is empty — list your first piece and start selling.</>
          ) : (
            <>Nothing here right now. <Link href="/dashboard/listings" className="underline underline-offset-2">See all listings</Link></>
          )}
        </div>
      ) : (
        <ul className="card-section divide-y divide-neutral-100">
          {listings.map((l) => {
            const thumb = l.photos[0]?.url;
            // Link target depends on public visibility:
            // ACTIVE/SOLD/SOLD_OUT → public listing page
            // DRAFT/HIDDEN/REJECTED/PENDING_REVIEW → preview page (?preview=1) so the
            // owner can see their listing without hitting the public 404.
            const isPublicStatus = l.status === "ACTIVE" || l.status === "SOLD" || l.status === "SOLD_OUT";
            const cardHref = isPublicStatus
              ? publicListingPath(l.id, l.title)
              : `${publicListingPath(l.id, l.title)}?preview=1`;
            const pill = STATUS_PILLS[l.status];

            return (
              <li key={l.id} className="flex gap-3.5 p-4">
                <Link href={cardHref} className="shrink-0" tabIndex={-1} aria-hidden="true">
                  <MediaImage
                    src={thumb}
                    alt=""
                    width={72}
                    height={90}
                    loading="lazy"
                    className="h-[90px] w-[72px] rounded-xl bg-[#EFEAE0] object-cover"
                    fallbackClassName="h-[90px] w-[72px] rounded-xl bg-[#EFEAE0]"
                  />
                </Link>
                <div className="min-w-0 flex-1 space-y-2">
                  <div className="flex items-baseline justify-between gap-3">
                    <h2 className="min-w-0 truncate font-medium">
                      <Link href={cardHref} className="hover:underline">{l.title}</Link>
                    </h2>
                    <span className="shrink-0 text-sm tabular-nums text-neutral-700">
                      {formatCurrencyCents(l.priceCents, l.currency)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-neutral-500">
                    {pill && (
                      <span className={`rounded-full px-2 py-0.5 font-medium ${pill.className}`}>{pill.label}</span>
                    )}
                    <span className="flex flex-wrap items-center gap-1">
                      <Eye size={11} className="inline align-middle" /> {l.viewCount} · <MousePointer size={11} className="inline align-middle" /> {l.clickCount} · <Heart size={11} className="inline align-middle" /> {l._count.favorites} · <Bell size={11} className="inline align-middle" /> {l._count.stockNotifications}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 pt-1">
                  <div className="flex flex-wrap gap-2">
                    {l.status !== "PENDING_REVIEW" && (
                      <Link href={`/dashboard/listings/${l.id}/edit`} className={DASHBOARD_ACTION_CLASS}>
                        Edit
                      </Link>
                    )}
                    {(l.status === "DRAFT" || l.status === "HIDDEN" || l.status === "PENDING_REVIEW" || l.status === "REJECTED") && (
                      <Link
                        href={`${publicListingPath(l.id, l.title)}?preview=1`}
                        className={DASHBOARD_ACTION_CLASS}
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Preview →
                      </Link>
                    )}

                    {l.status === "REJECTED" && <ResubmitButton listingId={l.id} />}

                    {l.status === "PENDING_REVIEW" && (
                      <InlineActionButton
                        action={withdrawListingReview.bind(null, l.id)}
                        confirm="Withdraw this listing from review and move it back to drafts?"
                        className={DASHBOARD_WARNING_ACTION_CLASS}
                      >
                        Withdraw
                      </InlineActionButton>
                    )}

                    {/* REJECTED: only Edit + Resubmit + Delete — no Hide/Unhide/Mark sold */}
                    {l.status !== "REJECTED" && l.status !== "PENDING_REVIEW" && (
                      <>
                        {/* Mark sold only for ACTIVE and SOLD_OUT — not DRAFT or HIDDEN */}
                        {(l.status === "ACTIVE" || l.status === "SOLD_OUT") && (
                          <InlineActionButton
                            action={setStatus.bind(null, l.id, ListingStatus.SOLD)}
                            className={DASHBOARD_ACTION_CLASS}
                          >
                            Mark sold
                          </InlineActionButton>
                        )}

                        {l.status === "HIDDEN" ? (
                          <ResubmitButton listingId={l.id} label="Unhide" />
                        ) : l.status === "ACTIVE" || l.status === "SOLD_OUT" ? (
                          <InlineActionButton
                            action={setStatus.bind(null, l.id, ListingStatus.HIDDEN)}
                            className={DASHBOARD_ACTION_CLASS}
                          >
                            Hide
                          </InlineActionButton>
                        ) : l.status === "DRAFT" ? (
                          <ResubmitButton listingId={l.id} label="Publish" />
                        ) : null}
                      </>
                    )}

                    {l.status !== "PENDING_REVIEW" && (
                      <InlineActionButton
                        action={deleteListing.bind(null, l.id)}
                        confirm="Delete this listing? This action is permanent. Saved listings and back-in-stock subscriptions will be removed. Listings required for order, review, or conversation history will be retained only as an archived record."
                        className={DASHBOARD_DANGER_ACTION_CLASS}
                      >
                        Delete
                      </InlineActionButton>
                    )}
                  </div>
                  {/* A sold piece has no stock to manage, as on the inventory page. */}
                  {l.listingType === "IN_STOCK" && l.status !== "SOLD" && (
                    <InventoryQuantityControl listing={l} actorScope={userId} />
                  )}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {totalPages > 1 && (
        <nav aria-label="Listing pages" className="flex items-center justify-between gap-3 text-sm">
          {page > 1 ? (
            <Link href={hrefFor(filter, page - 1)} className="btn btn-secondary btn-sm">Previous</Link>
          ) : <span />}
          <span className="text-neutral-500">Page {page} of {totalPages}</span>
          {page < totalPages ? (
            <Link href={hrefFor(filter, page + 1)} className="btn btn-secondary btn-sm">Next</Link>
          ) : <span />}
        </nav>
      )}
    </main>
  );
}
