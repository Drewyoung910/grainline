"use client";
// Maker card shown when a map pin is selected. Rendered as a React overlay
// pinned inside the map container (NOT a maplibre popup) so it can never be
// clipped by map bounds, never needs repositioning, and map pan/zoom doesn't
// dismiss or move it. Fetches /api/seller/[id]/map-card on mount with the
// per-map cache passed by the parent, so re-opening a pin is instant without
// persisting public seller snapshots longer than the current map mount.
import * as React from "react";
import { publicSellerPath } from "@/lib/publicPaths";
import { X } from "@/components/icons";

export type MakerMapCardData = {
  id: string;
  name: string;
  path: string;
  avatarUrl: string | null;
  photoUrl: string | null;
  guildLevel: string | null;
  city: string | null;
  state: string | null;
  tagline: string | null;
  rating: { avg: number; count: number } | null;
};

export type MakerMapCardCache = Map<string, MakerMapCardData | "error">;

function safeHttpsUrl(url: unknown): string | null {
  return typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
}

export default function MakerMapCard({
  sellerId,
  fallbackName,
  fallbackCity,
  fallbackState,
  cache,
  onClose,
}: {
  sellerId: string;
  fallbackName: string;
  fallbackCity?: string | null;
  fallbackState?: string | null;
  cache: MakerMapCardCache;
  onClose: () => void;
}) {
  const cardRef = React.useRef<HTMLDivElement>(null);
  const [data, setData] = React.useState<MakerMapCardData | "error" | null>(
    () => cache.get(sellerId) ?? null
  );

  React.useEffect(() => {
    const cached = cache.get(sellerId);
    if (cached) {
      setData(cached);
      return;
    }
    let cancelled = false;
    setData(null);
    fetch(`/api/seller/${encodeURIComponent(sellerId)}/map-card`)
      .then(async (res) =>
        res.ok ? ((await res.json()) as MakerMapCardData) : ("error" as const)
      )
      .catch(() => "error" as const)
      .then((result) => {
        const value =
          result !== "error" && result && typeof result.id === "string"
            ? result
            : ("error" as const);
        cache.set(sellerId, value);
        if (!cancelled) setData(value);
      });
    return () => {
      cancelled = true;
    };
  }, [cache, sellerId]);

  React.useEffect(() => {
    cardRef.current?.focus();
  }, [sellerId]);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const loaded = data !== null && data !== "error" ? data : null;
  const loading = data === null;
  const name = loaded?.name ?? fallbackName;
  const path = loaded?.path ?? publicSellerPath(sellerId, fallbackName);
  const location = [loaded?.city ?? fallbackCity, loaded?.state ?? fallbackState]
    .filter(Boolean)
    .join(", ");
  const photoUrl = safeHttpsUrl(loaded?.photoUrl);
  const avatarUrl = safeHttpsUrl(loaded?.avatarUrl);
  const guildLevel = loaded?.guildLevel ?? null;
  const rating = loaded?.rating ?? null;

  return (
    <div
      ref={cardRef}
      role="dialog"
      aria-label={`${name} — maker details`}
      tabIndex={-1}
      className="pointer-events-auto w-full overflow-hidden rounded-2xl bg-[#F7F5F0] shadow-2xl ring-1 ring-black/10 animate-menu-in motion-reduce:animate-none"
    >
      {/* Cover photo strip */}
      <div className="relative h-20 bg-[#EFEAE0]">
        {photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={photoUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
        ) : loading ? (
          <div className="h-full w-full animate-pulse bg-[#E3DCCB]/60" />
        ) : null}
        <button
          type="button"
          onClick={onClose}
          aria-label="Close maker details"
          className="absolute right-1.5 top-1.5 inline-flex h-8 w-8 items-center justify-center rounded-full bg-black/40 text-white hover:bg-black/60 transition-colors"
        >
          <X size={16} aria-hidden="true" />
        </button>
      </div>

      <div className="px-4 pb-4">
        {/* Avatar overlapping the cover */}
        <div className="relative -mt-6 h-12 w-12 overflow-hidden rounded-full border-[3px] border-[#F7F5F0] bg-[#EFEAE0]">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" loading="lazy" className="h-full w-full object-cover" />
          ) : null}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[15px] font-semibold leading-tight text-neutral-900">{name}</span>
          {(guildLevel === "GUILD_MEMBER" || guildLevel === "GUILD_MASTER") && (
            <span
              className={`rounded-full bg-white ring-1 ring-stone-200/60 px-2 py-0.5 text-[10px] font-semibold ${
                guildLevel === "GUILD_MASTER" ? "text-[#B8960C]" : "text-green-900"
              }`}
            >
              {guildLevel === "GUILD_MASTER" ? "Guild Master" : "Guild Member"}
            </span>
          )}
        </div>

        {rating && rating.count > 0 && (
          <div className="mt-0.5 text-xs text-neutral-600">
            <span className="text-amber-500" aria-hidden="true">★ </span>
            {(Math.round(rating.avg * 10) / 10).toFixed(1)} ({rating.count})
          </div>
        )}

        {location && <div className="mt-0.5 text-xs text-neutral-500">{location}</div>}

        {loading ? (
          <div className="mt-2 space-y-1.5">
            <div className="h-3 w-full animate-pulse rounded bg-[#E3DCCB]" />
            <div className="h-3 w-2/3 animate-pulse rounded bg-[#E3DCCB]" />
          </div>
        ) : loaded?.tagline ? (
          <p className="mt-1.5 line-clamp-2 text-xs text-neutral-600">{loaded.tagline}</p>
        ) : null}

        <a
          href={path}
          className="mt-3 block rounded-md bg-[#2C1F1A] px-3 py-2 text-center text-[13px] font-semibold text-white hover:bg-[#3A2A24] transition-colors"
        >
          Visit Workshop
        </a>
      </div>
    </div>
  );
}
