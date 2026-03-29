"use client";
import * as React from "react";
import Link from "next/link";
import { getRecentlyViewed } from "@/lib/recentlyViewed";

type RecentListing = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  photoUrl: string | null;
  sellerDisplayName: string;
  sellerAvatarImageUrl: string | null;
};

export default function RecentlyViewed() {
  const [listings, setListings] = React.useState<RecentListing[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const ids = getRecentlyViewed();
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    fetch(`/api/listings/recently-viewed?ids=${ids.join(",")}`)
      .then((r) => r.json())
      .then((data) => setListings((data.listings ?? []).slice(0, 6)))
      .catch(() => {/* silent */})
      .finally(() => setLoading(false));
  }, []);

  if (!loading && listings.length === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Recently Viewed</h2>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="rounded-xl border overflow-hidden animate-pulse shrink-0 w-48">
              <div className="h-40 bg-neutral-200" />
              <div className="p-3 space-y-2">
                <div className="h-3 bg-neutral-200 rounded w-3/4" />
                <div className="h-3 bg-neutral-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex gap-4 overflow-x-auto pb-2">
          {listings.map((l) => (
            <li key={l.id} className="rounded-xl border overflow-hidden hover:shadow-sm transition-shadow shrink-0 w-48">
              <Link href={`/listing/${l.id}`} className="block">
                <div className="h-40 bg-neutral-100 overflow-hidden">
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
                <div className="p-3 space-y-1">
                  <div className="font-medium text-sm line-clamp-2">{l.title}</div>
                  <div className="text-sm text-neutral-500">
                    {(l.priceCents / 100).toLocaleString(undefined, {
                      style: "currency",
                      currency: l.currency,
                    })}
                  </div>
                  <div className="flex items-center gap-1.5 pt-0.5">
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
                    <span className="text-xs text-neutral-500 truncate">{l.sellerDisplayName}</span>
                  </div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
