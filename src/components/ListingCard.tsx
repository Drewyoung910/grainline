"use client";

import { useState } from "react";
import Link from "next/link";
import FavoriteButton from "@/components/FavoriteButton";
import GuildBadge, { type GuildLevelValue } from "@/components/GuildBadge";
import MediaImage from "@/components/MediaImage";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";

export type ListingCardData = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: string;
  listingType: string;
  stockQuantity?: number | null;
  photoUrl: string | null;
  secondPhotoUrl?: string | null;
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
  href?: string | null;
};

export default function ListingCard({ listing: l, initialSaved = false, href }: Props) {
  const [hovered, setHovered] = useState(false);
  const img = l.photoUrl ?? "/favicon.ico";
  const displayImg = hovered && l.secondPhotoUrl ? l.secondPhotoUrl : img;
  const listingHref = href === null ? null : href ?? publicListingPath(l.id, l.title);
  const sellerName = l.seller.displayName ?? "Maker";
  const shop = l.rating;
  const city = l.seller.city;
  const state = l.seller.state;

  return (
    <div className="group">
      {/* Photo */}
      <div
        className="relative rounded-2xl overflow-hidden"
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      >
        {listingHref ? (
          <Link href={listingHref} className="block">
            <MediaImage
              alt={l.title}
              src={displayImg}
              fallbackSrc={displayImg === l.secondPhotoUrl ? l.photoUrl : l.secondPhotoUrl}
              loading="lazy"
              className="w-full aspect-square object-cover transition-all duration-300 motion-safe:group-hover:scale-105"
              fallbackClassName="w-full aspect-square bg-gradient-to-br from-amber-50 to-stone-100"
            />
          </Link>
        ) : (
          <MediaImage
            alt={l.title}
            src={displayImg}
            fallbackSrc={displayImg === l.secondPhotoUrl ? l.photoUrl : l.secondPhotoUrl}
            loading="lazy"
            className="w-full aspect-square object-cover transition-all duration-300 motion-safe:group-hover:scale-105"
            fallbackClassName="w-full aspect-square bg-gradient-to-br from-amber-50 to-stone-100"
          />
        )}
        {/* Heart — top right */}
        <div className="absolute top-2 right-2">
          <FavoriteButton listingId={l.id} initialSaved={initialSaved} />
        </div>
      </div>

      {/* Metadata area — two columns: text left, guild badge right */}
      <div className="flex items-center gap-3 pt-2.5">
        <div className="flex-1 min-w-0 space-y-0.5">
          {/* Title and price+rating — wrapped in listing Link */}
          {listingHref ? (
            <Link href={listingHref} className="block space-y-0.5">
              <ListingCardTitlePrice
                title={l.title}
                priceCents={l.priceCents}
                currency={l.currency}
                rating={shop}
              />
            </Link>
          ) : (
            <div className="block space-y-0.5">
              <ListingCardTitlePrice
                title={l.title}
                priceCents={l.priceCents}
                currency={l.currency}
                rating={shop}
              />
            </div>
          )}

          {/* Location · Seller — separate row, no nested Links */}
          <div className="flex items-center gap-1 text-xs text-stone-500 flex-wrap">
            {(city || state) && (
              <>
                <span className="truncate">{[city, state].filter(Boolean).join(", ")}</span>
                <span>·</span>
              </>
            )}
            <Link
              href={publicSellerPath(l.seller.id, sellerName)}
              className="hover:text-neutral-600 hover:underline truncate max-w-[120px]"
            >
              {sellerName}
            </Link>
          </div>

          {l.seller.acceptingNewOrders === false && (
            <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 mt-0.5 inline-block">
              Not accepting orders
            </span>
          )}
        </div>

        {/* Guild badge — right column */}
        {l.seller.guildLevel && l.seller.guildLevel !== "NONE" && (
          <div className="flex-none">
            <GuildBadge level={l.seller.guildLevel as GuildLevelValue} showLabel={false} size={40} />
          </div>
        )}
      </div>
    </div>
  );
}

function ListingCardTitlePrice({
  title,
  priceCents,
  currency,
  rating,
}: {
  title: string;
  priceCents: number;
  currency: string;
  rating?: { avg: number; count: number } | null;
}) {
  return (
    <>
      <div className="font-medium text-sm text-neutral-900 line-clamp-1 leading-snug">
        {title}
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-bold text-sm text-neutral-900">
          {(priceCents / 100).toLocaleString("en-US", { style: "currency", currency })}
        </span>
        {rating && rating.count > 0 && (
          <span className="flex items-center gap-0.5 text-xs text-stone-500">
            <span className="text-amber-500">★</span>
            <span className="font-medium text-neutral-700">{(Math.round(rating.avg * 10) / 10).toFixed(1)}</span>
            <span className="text-stone-500">({rating.count})</span>
          </span>
        )}
      </div>
    </>
  );
}
