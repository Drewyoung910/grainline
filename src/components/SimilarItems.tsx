"use client";
import * as React from "react";
import ListingCard from "@/components/ListingCard";
import ClickTracker from "@/components/ClickTracker";
import ScrollFadeRow from "@/components/ScrollFadeRow";

type SimilarListing = {
  id: string;
  title: string;
  priceCents: number;
  currency: string;
  status: string;
  listingType: string;
  stockQuantity: number | null;
  photoUrl: string | null;
  secondPhotoUrl: string | null;
  seller: {
    id: string;
    displayName: string | null;
    avatarImageUrl: string | null;
    guildLevel: string | null;
    city: string | null;
    state: string | null;
    acceptingNewOrders: boolean | null;
  };
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
    <div>
      {loading ? (
        <div className="flex gap-4 overflow-hidden">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="w-56 flex-none animate-pulse">
              <div className="aspect-square bg-neutral-200 rounded-2xl" />
              <div className="pt-2.5 space-y-1.5">
                <div className="h-4 bg-neutral-200 rounded w-3/4" />
                <div className="h-3 bg-neutral-200 rounded w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <ScrollFadeRow className="overflow-x-auto -mx-4 px-4 sm:-mx-0 sm:px-0">
          <ul className="flex gap-4 snap-x snap-mandatory pb-0" style={{ width: "max-content" }}>
            {listings.map((l) => (
              <ClickTracker key={l.id} listingId={l.id} className="snap-start flex-none w-56">
                <ListingCard
                  listing={{
                    id: l.id,
                    title: l.title,
                    priceCents: l.priceCents,
                    currency: l.currency,
                    status: l.status,
                    listingType: l.listingType,
                    stockQuantity: l.stockQuantity,
                    photoUrl: l.photoUrl,
                    secondPhotoUrl: l.secondPhotoUrl,
                    seller: {
                      id: l.seller.id,
                      displayName: l.seller.displayName,
                      avatarImageUrl: l.seller.avatarImageUrl,
                      guildLevel: l.seller.guildLevel,
                      city: l.seller.city,
                      state: l.seller.state,
                      acceptingNewOrders: l.seller.acceptingNewOrders,
                    },
                  }}
                  initialSaved={false}
                  variant="scroll"
                />
              </ClickTracker>
            ))}
          </ul>
        </ScrollFadeRow>
      )}
    </div>
  );
}
