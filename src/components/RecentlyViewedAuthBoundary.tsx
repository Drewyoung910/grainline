"use client";

import { useUser } from "@clerk/nextjs";
import * as React from "react";
import {
  clearRecentlyViewed,
  RECENTLY_VIEWED_USER_STORAGE_KEY,
  recentlyViewedAuthTransition,
} from "@/lib/recentlyViewed";

export default function RecentlyViewedAuthBoundary() {
  const { isLoaded, isSignedIn, user } = useUser();

  React.useEffect(() => {
    if (!isLoaded) return;

    const currentUserId = isSignedIn ? user?.id ?? null : null;
    try {
      const previousUserId = window.localStorage.getItem(RECENTLY_VIEWED_USER_STORAGE_KEY);
      const transition = recentlyViewedAuthTransition({ previousUserId, currentUserId });
      if (transition.shouldClear) clearRecentlyViewed();

      if (transition.nextUserId) {
        window.localStorage.setItem(RECENTLY_VIEWED_USER_STORAGE_KEY, transition.nextUserId);
      } else {
        window.localStorage.removeItem(RECENTLY_VIEWED_USER_STORAGE_KEY);
      }
    } catch {
      if (!currentUserId) clearRecentlyViewed();
    }
  }, [isLoaded, isSignedIn, user?.id]);

  return null;
}
