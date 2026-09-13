"use client";

import { useUser } from "@clerk/nextjs";
import * as React from "react";
import {
  RECENTLY_VIEWED_USER_STORAGE_KEY,
  recentlyViewedAuthTransition,
} from "@/lib/recentlyViewed";
import { clearSignedOutLocalAccountState } from "@/lib/localAccountState";

export default function RecentlyViewedAuthBoundary() {
  const { isLoaded, isSignedIn, user } = useUser();

  React.useEffect(() => {
    if (!isLoaded) return;

    const currentUserId = isSignedIn ? user?.id ?? null : null;
    try {
      const previousUserId = window.localStorage.getItem(RECENTLY_VIEWED_USER_STORAGE_KEY);
      const transition = recentlyViewedAuthTransition({ previousUserId, currentUserId });
      if (transition.shouldClear) clearSignedOutLocalAccountState();

      if (transition.nextUserId) {
        window.localStorage.setItem(RECENTLY_VIEWED_USER_STORAGE_KEY, transition.nextUserId);
      } else {
        window.localStorage.removeItem(RECENTLY_VIEWED_USER_STORAGE_KEY);
      }
    } catch {
      if (!currentUserId) clearSignedOutLocalAccountState();
    }
  }, [isLoaded, isSignedIn, user?.id]);

  return null;
}
