"use client";
import * as React from "react";
import Link from "next/link";
import { getRecentlyViewed, setRecentlyViewed } from "@/lib/recentlyViewed";
import { useToast } from "@/components/Toast";
import { publicListingPath } from "@/lib/publicPaths";

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
  const { toast } = useToast();
  const [listings, setListings] = React.useState<RecentListing[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    const ids = getRecentlyViewed();
    if (ids.length === 0) {
      setLoading(false);
      return;
    }
    fetch(`/api/listings/recently-viewed?ids=${ids.join(",")}`)
      .then(async (r) => {
        const data = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(data?.error || "Could not load recently viewed listings.");
        return data;
      })
      .then((data) => {
        const nextListings = (data.listings ?? []).slice(0, 6);
        setListings(nextListings);
        setRecentlyViewed(nextListings.map((listing: RecentListing) => listing.id));
      })
      .catch((error) => {
        toast(error instanceof Error ? error.message : "Could not load recently viewed listings.", "error");
      })
      .finally(() => setLoading(false));
  }, [toast]);

  if (!loading && listings.length === 0) return null;

  return (
    <section className="space-y-4">
      <h2 className="text-xl font-semibold">Recently Viewed</h2>

      {loading ? (
        <div className="flex gap-4 overflow-x-auto pb-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="animate-pulse shrink-0 w-48">
              <div className="rounded-2xl overflow-hidden aspect-square bg-neutral-200" />
              <div className="mt-2 space-y-1.5 px-0.5">
                <div className="h-3 bg-neutral-200 rounded w-3/4" />
                <div className="h-3 bg-neutral-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ul className="flex gap-4 overflow-x-auto pb-0">
          {listings.map((l) => (
            <li key={l.id} className="shrink-0 w-48 group">
              <Link href={publicListingPath(l.id, l.title)} className="block">
                <div className="rounded-2xl overflow-hidden aspect-square bg-neutral-100">
                  {l.photoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={l.photoUrl}
                      alt={l.title}
                      loading="lazy"
                      className="h-full w-full object-cover group-hover:scale-105 transition-transform duration-300"
                    />
                  ) : (
                    <div className="h-full w-full bg-neutral-200" />
                  )}
                </div>
                <div className="mt-2 px-0.5 space-y-0.5">
                  <div className="font-medium text-sm line-clamp-1 text-neutral-900">{l.title}</div>
                  <div className="text-sm text-neutral-500">
                    {(l.priceCents / 100).toLocaleString("en-US", {
                      style: "currency",
                      currency: l.currency,
                    })}
                  </div>
                  <div className="text-xs text-neutral-400 truncate">{l.sellerDisplayName}</div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
