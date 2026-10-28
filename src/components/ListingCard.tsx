"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import FavoriteButton from "@/components/FavoriteButton";
import GuildBadge, { type GuildLevelValue } from "@/components/GuildBadge";
import MediaImage from "@/components/MediaImage";
import { publicListingPath, publicSellerPath } from "@/lib/publicPaths";
import { formatCurrencyCents } from "@/lib/money";
import { formatCityState } from "@/lib/locationDisplay";

export type ListingCardData = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: string;
  listingType: string;
  stockQuantity?: number | null;
  photoUrl: string | null;
  photoAltText?: string | null;
  secondPhotoUrl?: string | null;
  secondPhotoAltText?: string | null;
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

type PhotoState = "idle" | "pending" | "revealed";

export default function ListingCard({ listing: l, initialSaved = false, href }: Props) {
  const photoRef = useRef<HTMLDivElement>(null);
  const photoPendingRef = useRef(false);
  const [photoState, setPhotoState] = useState<PhotoState>("idle");
  const [altRequested, setAltRequested] = useState(false);
  const [altReady, setAltReady] = useState(false);
  const img = l.photoUrl ?? "/favicon.ico";
  const altSrc = l.secondPhotoUrl && l.secondPhotoUrl !== img ? l.secondPhotoUrl : null;
  const listingHref = href === null ? null : href ?? publicListingPath(l.id, l.title);
  const sellerName = l.seller.displayName ?? "Maker";
  const shop = l.rating;
  const location = formatCityState(l.seller.city, l.seller.state);
  const hasGuildBadge = Boolean(l.seller.guildLevel && l.seller.guildLevel !== "NONE");

  // Only a photo that has not started rendering yet is hidden; it fades in
  // once it loads. Photos already painted (cached or above the fold) are
  // left alone so nothing flickers after hydration.
  useEffect(() => {
    const photo = photoRef.current?.querySelector<HTMLImageElement>("img[data-card-photo]");
    if (photo && !photo.complete && photo.naturalWidth === 0) {
      photoPendingRef.current = true;
      setPhotoState("pending");
    }
  }, []);

  const finishPhoto = (reveal: boolean) => {
    if (!photoPendingRef.current) return;
    photoPendingRef.current = false;
    setPhotoState(reveal ? "revealed" : "idle");
  };

  const photo = (
    <>
      <MediaImage
        alt={l.photoAltText || l.title}
        src={img}
        fallbackSrc={l.secondPhotoUrl}
        loading="lazy"
        data-card-photo=""
        data-photo-state={photoState}
        onLoad={() => finishPhoto(true)}
        onError={() => finishPhoto(false)}
        className="w-full aspect-[4/5] object-cover listing-photo backface-hidden transition-transform duration-700 ease-out motion-safe:group-hover:scale-[1.04]"
        fallbackClassName="w-full aspect-[4/5] bg-gradient-to-br from-amber-50 to-stone-100"
      />
      {/* Second photo: requested on first hover, then cross-fades in while hovered. */}
      {altRequested && altSrc && (
        <MediaImage
          alt=""
          aria-hidden="true"
          src={altSrc}
          data-ready={altReady ? "true" : "false"}
          onLoad={() => setAltReady(true)}
          className="pointer-events-none absolute inset-0 h-full w-full object-cover opacity-0 backface-hidden transition duration-700 ease-out motion-safe:group-hover:scale-[1.04] group-hover:data-[ready=true]:opacity-100"
          fallbackClassName="hidden"
        />
      )}
    </>
  );

  return (
    <div className="group">
      {/* Photo */}
      <div
        ref={photoRef}
        className="relative isolate rounded-2xl overflow-hidden bg-[#EFEAE0]"
        onPointerEnter={(event) => {
          // Touch devices never show the hover photo, so don't download it.
          if (event.pointerType === "mouse" && altSrc && !altRequested) setAltRequested(true);
        }}
      >
        {listingHref ? (
          <Link href={listingHref} className="block">
            {photo}
          </Link>
        ) : (
          photo
        )}
        {/* Heart — top right */}
        <FavoriteButton listingId={l.id} initialSaved={initialSaved} />
      </div>

      {/* Metadata area */}
      <div className="@container min-w-0 space-y-1 pt-3">
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

        {/* Maker · location — separate row, no nested Links. On narrow cards
            the location moves under the maker so the name stays readable;
            on wider cards it shares the row, and the grid gives the name its
            full width before the location gets any. */}
        <div className="grid min-w-0 grid-cols-[minmax(0,max-content)_minmax(0,1fr)] items-center gap-x-1.5 gap-y-0.5 text-[13px] leading-snug text-stone-600 @max-[15rem]:grid-cols-1">
          <span className="flex min-w-0 max-w-full items-center gap-1.5">
            <Link
              href={publicSellerPath(l.seller.id, sellerName)}
              className="min-w-0 truncate font-medium text-stone-700 transition-colors hover:text-neutral-900 hover:underline"
            >
              {sellerName}
            </Link>
            {hasGuildBadge && (
              // Invisible 36 px tap area around the 20 px badge; layout unchanged.
              <span className="inline-flex flex-none [&>button]:relative [&>button]:before:absolute [&>button]:before:-inset-2">
                <GuildBadge level={l.seller.guildLevel as GuildLevelValue} showLabel={false} size={20} />
              </span>
            )}
          </span>
          {location && (
            <MetaSeparatorText>{location}</MetaSeparatorText>
          )}
        </div>

        {l.seller.acceptingNewOrders === false && (
          <span className="mt-0.5 inline-block rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[10px] text-amber-700">
            Not accepting orders
          </span>
        )}
      </div>
    </div>
  );
}

function MetaSeparatorText({ children }: { children: ReactNode }) {
  return (
    <span className="min-w-0 truncate">
      <span aria-hidden="true" className="text-stone-400 @max-[15rem]:hidden">· </span>
      {children}
    </span>
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
      <div className="line-clamp-1 text-[15px] font-medium leading-snug text-neutral-900">
        {title}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[15px] font-semibold tabular-nums text-neutral-900">
          {formatCurrencyCents(priceCents, currency)}
        </span>
        {rating && rating.count > 0 && (
          <span className="flex items-center gap-0.5 text-[13px] text-stone-600">
            <span className="text-amber-500">★</span>
            <span className="font-medium text-neutral-700">{(Math.round(rating.avg * 10) / 10).toFixed(1)}</span>
            <span className="text-stone-500">({rating.count})</span>
          </span>
        )}
      </div>
    </>
  );
}
