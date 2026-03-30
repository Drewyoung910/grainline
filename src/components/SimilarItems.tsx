"use client";
import * as React from "react";
import Link from "next/link";
import FavoriteButton from "@/components/FavoriteButton";
import GuildBadge, { type GuildLevelValue } from "@/components/GuildBadge";

type SimilarListing = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  photoUrl: string | null;
  sellerDisplayName: string;
  sellerAvatarImageUrl: string | null;
  sellerGuildLevel?: string | null;
};

export default function SimilarItems({ listingId }: { listingId: string }) {
  const [listings, setListings] = React.useState<SimilarListing[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    fetch(`/api/listings/${listingId}/similar`)
      .then((r) => r.json())
      .then((data) => {
        setListings(data.listings ?? []);
      })
      .catch(() => {/* silent */})
      .finally(() => setLoading(false));
  }, [listingId]);

  if (!loading && listings.length === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">You Might Also Like</h2>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="border border-neutral-200 overflow-hidden animate-pulse">
              <div className="h-48 bg-neutral-200" />
              <div className="p-4 space-y-2">
                <div className="h-4 bg-neutral-200 rounded w-3/4" />
                <div className="h-3 bg-neutral-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
          {listings.map((l) => (
            <li key={l.id} className="relative border border-neutral-200 overflow-hidden hover:shadow-sm transition-shadow">
              <Link href={`/listing/${l.id}`} className="block">
                <div className="h-48 bg-neutral-100 overflow-hidden">
                  {l.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={l.photoUrl}
                      alt={l.title}
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="h-full w-full bg-neutral-200" />
                  )}
                </div>
                <div className="p-4 space-y-1 bg-stone-50">
                  <div className="font-medium text-sm line-clamp-2">{l.title}</div>
                  <div className="text-sm text-neutral-500">
                    {(l.priceCents / 100).toLocaleString(undefined, {
                      style: "currency",
                      currency: l.currency,
                    })}
                  </div>
                  <div className="flex items-center flex-wrap gap-1.5 pt-1">
                    {l.sellerAvatarImageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={l.sellerAvatarImageUrl}
                        alt={l.sellerDisplayName}
                        className="h-4 w-4 rounded-full object-cover"
                      />
                    ) : (
                      <div className="h-4 w-4 rounded-full bg-neutral-300" />
                    )}
                    <span className="text-xs text-neutral-500">{l.sellerDisplayName}</span>
                    {l.sellerGuildLevel && l.sellerGuildLevel !== "NONE" && (
                      <GuildBadge level={l.sellerGuildLevel as GuildLevelValue} showLabel={false} size={16} />
                    )}
                  </div>
                </div>
              </Link>
              <FavoriteButton listingId={l.id} initialSaved={false} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
