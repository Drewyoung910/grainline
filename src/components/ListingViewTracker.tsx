"use client";
import { useEffect } from "react";

export default function ListingViewTracker({ listingId }: { listingId: string }) {
  useEffect(() => {
    fetch(`/api/listings/${listingId}/view`, { method: "POST" }).catch(() => {});
  }, [listingId]);
  return null;
}
