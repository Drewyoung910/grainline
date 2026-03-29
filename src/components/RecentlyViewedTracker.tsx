"use client";
import * as React from "react";
import { addRecentlyViewed } from "@/lib/recentlyViewed";

export default function RecentlyViewedTracker({ listingId }: { listingId: string }) {
  React.useEffect(() => {
    addRecentlyViewed(listingId);
  }, [listingId]);

  return null;
}
