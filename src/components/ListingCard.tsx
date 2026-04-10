"use client";

import { useState } from "react";
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
};

export default function ListingCard({ listing: l, initialSaved = false, variant = "grid" }: Props) {
  const [hovered, setHovered] = useState(false);
  const img = l.photoUrl ?? "/favicon.ico";
  const displayImg = hovered && l.secondPhotoUrl ? l.secondPhotoUrl : img;
  const sellerName = l.seller.displayName ?? "Maker";
  const sellerAvatar = l.seller.avatarImageUrl ?? null;
  const initials = (sellerName || "S").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("") || "S";
  const shop = l.rating;
  const isReady = l.listingType === "IN_STOCK";
  const city = l.seller.city;
  const state = l.seller.state;

  const photo = (
    <div
      className="relative rounded-2xl overflow-hidden"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <Link href={`/listing/${l.id}`} className="block">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          alt={l.title}
          src={displayImg}
          className="w-full aspect-square object-cover transition-all duration-300 group-hover:scale-105"
        />
      </Link>
      <div className="absolute top-2 right-2">
        <FavoriteButton listingId={l.id} initialSaved={initialSaved} />
      </div>
    </div>
  );

  const meta = (
    <Link href={`/listing/${l.id}`} className="block pt-2.5 space-y-0.5">
      <div className={`font-medium text-neutral-900 line-clamp-2 leading-snug ${variant === "scroll" ? "text-sm" : "text-sm"}`}>
        {l.title}
      </div>
      <div className="font-bold text-sm text-neutral-900">
        {(l.priceCents / 100).toLocaleString("en-US", { style: "currency", currency: l.currency })}
      </div>
      {shop && shop.count > 0 && (
        <div className="flex items-center gap-1 text-xs">
          <span className="text-amber-500">★</span>
          <span className="font-medium text-neutral-700">{(Math.round(shop.avg * 10) / 10).toFixed(1)}</span>
          <span className="text-stone-400">({shop.count})</span>
        </div>
      )}
      <div className="flex items-center gap-2 flex-wrap pt-0.5">
        {(city || state) && (
          <span className="text-[11px] text-stone-400 truncate">
            {[city, state].filter(Boolean).join(", ")}
          </span>
        )}
        <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full ${
          isReady
            ? "bg-green-50 text-green-700 border border-green-200"
            : "bg-amber-50 text-amber-700 border border-amber-200"
        }`}>
          {isReady ? "Ready to ship" : "Made to order"}
        </span>
      </div>
    </Link>
  );

  const sellerChip = (
    <div className="pt-1.5 flex items-center flex-wrap gap-1.5">
      <Link
        href={`/seller/${l.seller.id}`}
        className="text-xs text-stone-500 hover:text-neutral-700 hover:underline transition-colors truncate max-w-[140px]"
      >
        {sellerName}
      </Link>
      {l.seller.guildLevel && l.seller.guildLevel !== "NONE" && (
        <GuildBadge level={l.seller.guildLevel as GuildLevelValue} showLabel={false} size={16} />
      )}
      {l.seller.acceptingNewOrders === false && (
        <span className="text-[10px] text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
          Not accepting orders
        </span>
      )}
    </div>
  );

  return (
    <div className="group">
      {photo}
      {meta}
      {sellerChip}
    </div>
  );
}
