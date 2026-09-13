"use client";
import Link from "next/link";
import { Eye, Heart, Bell, MousePointer } from "@/components/icons";
import { publicListingPath } from "@/lib/publicPaths";
import { formatCurrencyCents } from "@/lib/money";
import InventoryQuantityControl from "@/components/InventoryQuantityControl";

type Listing = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: string;
  stockQuantity: number | null;
  viewCount: number;
  clickCount: number;
  photos: Array<{ url: string }>;
  _count: { favorites: number; stockNotifications: number };
};

export default function InventoryRow({ listing, actorScope }: { listing: Listing; actorScope: string }) {
  const thumb = listing.photos[0]?.url;
  const titleHref = listing.status === "PENDING_REVIEW"
    ? `${publicListingPath(listing.id, listing.title)}?preview=1`
    : `/dashboard/listings/${listing.id}/edit`;


  return (
    <li className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-center gap-3">
        {thumb ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={thumb} alt="" className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 object-cover" />
        ) : (
          <div className="h-14 w-14 shrink-0 rounded-lg border border-neutral-200 bg-neutral-100" />
        )}

        <div className="min-w-0 flex-1">
          <Link
            href={titleHref}
            className="block truncate text-sm font-medium hover:underline"
          >
            {listing.title}
          </Link>
          <div className="text-xs text-neutral-500">
            {formatCurrencyCents(listing.priceCents, listing.currency)}
            {listing.status === "SOLD_OUT" && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
                Out of stock
              </span>
            )}
            {listing.status === "DRAFT" && (
              <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
                Draft
              </span>
            )}
            {listing.status === "HIDDEN" && (
              <span className="ml-2 rounded-full bg-neutral-100 px-2 py-0.5 text-neutral-600">
                Hidden
              </span>
            )}
            {listing.status === "PENDING_REVIEW" && (
              <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">
                Under Review
              </span>
            )}
            {listing.status === "REJECTED" && (
              <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-red-700">
                Rejected
              </span>
            )}
          </div>
          <div className="text-[11px] text-neutral-500 mt-0.5">
            <Eye size={11} className="inline align-middle" /> {listing.viewCount} · <MousePointer size={11} className="inline align-middle" /> {listing.clickCount} · <Heart size={11} className="inline align-middle" /> {listing._count.favorites} · <Bell size={11} className="inline align-middle" /> {listing._count.stockNotifications}
          </div>
        </div>
      </div>

      <InventoryQuantityControl listing={listing} actorScope={actorScope} />
    </li>
  );
}
