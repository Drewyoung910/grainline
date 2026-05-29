"use client";

import * as React from "react";
import { useUser } from "@clerk/nextjs";

export default function UnreadBadge({
  className = "",
  pollMs = 600000,
}: { className?: string; pollMs?: number }) {
  const { isLoaded, isSignedIn } = useUser();
  const [count, setCount] = React.useState<number>(0);

  const refresh = React.useCallback(async () => {
    if (!isLoaded || !isSignedIn) return;
    try {
      const res = await fetch("/api/messages/unread-count", { cache: "no-store" });
      if (!res.ok) return;
      const data = await res.json();
      if (typeof data?.count === "number") setCount(data.count);
    } catch (error) {
      console.warn("[unread-badge] refresh failed", error);
    }
  }, [isLoaded, isSignedIn]);

  React.useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      setCount(0);
      return;
    }
    refresh();
    const id = window.setInterval(refresh, pollMs);
    return () => window.clearInterval(id);
  }, [isLoaded, isSignedIn, pollMs, refresh]);

  if (!count) return null;

  return (
    <span
      aria-label={`${count} unread message${count === 1 ? "" : "s"}`}
      className={`absolute -top-1 -right-1 inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] leading-none text-white ${className}`}
    >
      <span aria-hidden="true">{count}</span>
    </span>
  );
}
