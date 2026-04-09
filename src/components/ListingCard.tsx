"use client";

import Link from "next/link";
import FavoriteButton from "@/components/FavoriteButton";
import GuildBadge, { type GuildLevelValue } from "@/components/GuildBadge";

export type ListingCardData = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: string;
  listingType: string;
  stockQuantity?: number | null;
  photoUrl: string | null;
  seller: {
    id: string;
    displayName: string | null;
    avatarImageUrl: string | null;
    guildLevel: string | null;
    city: string | null;
    state: string | null;
    acceptingNewOrders: boolean | null;
  };
  rating?: { avg: number; count: number } | null;
};

type Props = {
  listing: ListingCardData;
  initialSaved?: boolean;
  variant?: "grid" | "scroll";
};

function StarsInline({ value }: { value: number }) {
  const pct = Math.max(0, Math.min(100, (value / 5) * 100));
  return (
    <span className="relative leading-none inline-block align-middle" aria-hidden>
      <span className="text-neutral-300">★★★★★</span>
      <span className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }}>
        <span className="text-amber-500">★★★★★</span>
      </span>
    </span>
  );
}

export default function ListingCard({ listing: l, initialSaved = false, variant = "grid" }: Props) {
  const img = l.photoUrl ?? "/favicon.ico";
  const sellerName = l.seller.displayName ?? "Maker";
  const sellerAvatar = l.seller.avatarImageUrl ?? null;
  const initials = (sellerName || "S").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "S";
  const shop = l.rating;
  const isAvailable = l.status === "ACTIVE";

  if (variant === "scroll") {
    return (
      <div>
        <div className="relative">
          <Link href={`/listing/${l.id}`} className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img alt={l.title} src={img} className="w-full aspect-[4/3] object-cover" />
          </Link>
          <div className="absolute top-2 right-2">
            <FavoriteButton listingId={l.id} initialSaved={initialSaved} />
          </div>
        </div>
        <Link href={`/listing/${l.id}`} className="block">
          <div className="p-3 space-y-1 bg-white">
            <div className="font-medium text-sm leading-snug line-clamp-2 text-neutral-900">{l.title}</div>
            <div className="text-sm font-semibold text-neutral-900">
              {(l.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: l.currency })}
            </div>
            {shop && shop.count > 0 && (
              <div className="flex items-center gap-1.5 text-xs text-stone-500">
                <StarsInline value={shop.avg} />
                <span>{(Math.round(shop.avg * 10) / 10).toFixed(1)}</span>
              </div>
            )}
          </div>
        </Link>
        <div className="px-3 pb-3 bg-white">
          <div className="flex items-center flex-wrap gap-1">
            <Link href={`/seller/${l.seller.id}`} className="inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs hover:bg-stone-100">
              {sellerAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={sellerAvatar} alt={sellerName} className="h-4 w-4 rounded-full object-cover" />
              ) : (
                <div className="flex h-4 w-4 items-center justify-center rounded-full bg-neutral-200">
                  <span className="text-[9px] font-medium text-neutral-700">{initials}</span>
                </div>
              )}
              <span className="truncate max-w-[80px] text-stone-500">{sellerName}</span>
            </Link>
            {l.seller.guildLevel && l.seller.guildLevel !== "NONE" && (
              <GuildBadge level={l.seller.guildLevel as GuildLevelValue} showLabel={false} size={16} />
            )}
          </div>
        </div>
      </div>
    );
  }

  // variant === "grid"
  return (
    <div className="card-listing">
      <div className="relative">
        <Link href={`/listing/${l.id}`} className="block">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img alt={l.title} src={img} className="w-full aspect-[4/3] object-cover" />
        </Link>
        <div className="absolute top-2 right-2">
          <FavoriteButton listingId={l.id} initialSaved={initialSaved} />
        </div>
      </div>
      <Link href={`/listing/${l.id}`} className="block">
        <div className="p-4 space-y-1 bg-white">
          <div className="font-medium text-sm text-neutral-900 line-clamp-1">{l.title}</div>
          <div className="font-semibold text-base text-neutral-900">
            {(l.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: l.currency })}
          </div>
          {!isAvailable && (
            <p className="text-xs text-red-500">No longer available</p>
          )}
          {shop && shop.count > 0 && (
            <div className="flex items-center gap-2 text-xs text-stone-500">
              <StarsInline value={shop.avg} />
              <span>{(Math.round(shop.avg * 10) / 10).toFixed(1)}</span>
              <span className="text-stone-400">({shop.count})</span>
            </div>
          )}
        </div>
      </Link>
      <div className="px-4 pb-4 bg-white">
        <div className="flex items-center flex-wrap gap-1.5">
          <Link
            href={`/seller/${l.seller.id}`}
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
          {l.seller.guildLevel && l.seller.guildLevel !== "NONE" && (
            <GuildBadge level={l.seller.guildLevel as GuildLevelValue} showLabel={false} size={16} />
          )}
        </div>
        {l.seller.acceptingNewOrders === false && (
          <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mt-1 inline-block">
            Not accepting new orders
          </span>
        )}
      </div>
    </div>
  );
}
