"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import Link from "next/link";
import type { FeedItem } from "@/app/api/account/feed/route";

export default function FeedClient() {
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [initialLoading, setInitialLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    setLoading(true);
    setError(null);
    try {
      const url = `/api/account/feed?limit=20${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error("Failed to load feed");
      const data = await res.json();
      setItems((prev) => [...prev, ...data.items]);
      setCursor(data.nextCursor);
      setHasMore(data.hasMore);
    } catch {
      setError("Failed to load feed. Please try again.");
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }, [loading, hasMore, cursor]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load first batch on mount
  useEffect(() => {
    loadMore();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Intersection observer for infinite scroll
  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading && hasMore) {
          loadMore();
        }
      },
      { threshold: 0.1, rootMargin: "200px" }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loading, hasMore, loadMore]);

  if (initialLoading) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-4">
        {[...Array(5)].map((_, i) => (
          <div key={i} className="border border-neutral-200 p-4 animate-pulse">
            <div className="h-4 bg-neutral-200 w-1/3 mb-3" />
            <div className="h-32 bg-neutral-100 mb-3" />
            <div className="h-3 bg-neutral-200 w-2/3" />
          </div>
        ))}
      </div>
    );
  }

  if (!initialLoading && items.length === 0 && !error) {
    return (
      <div className="max-w-2xl mx-auto px-4 py-16 text-center">
        <p className="text-neutral-500 mb-4">Your feed is empty.</p>
        <p className="text-sm text-neutral-400 mb-6">
          Follow some makers to see their latest listings and posts here.
        </p>
        <Link
          href="/browse"
          className="inline-block border border-neutral-900 px-4 py-2 text-sm hover:bg-neutral-50"
        >
          Browse Makers →
        </Link>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold font-display">Your Feed</h1>
        <Link href="/account/following" className="text-sm text-neutral-500 hover:underline">
          Manage following →
        </Link>
      </div>

      {error && (
        <div className="border border-red-200 bg-red-50 text-red-700 text-sm p-3 mb-4">{error}</div>
      )}

      <div className="space-y-4">
        {items.map((item, idx) => (
          <FeedCard key={`${item.kind}-${item.id ?? item.slug ?? idx}`} item={item} />
        ))}
      </div>

      {/* Sentinel for infinite scroll */}
      <div ref={sentinelRef} className="h-4" />

      {loading && !initialLoading && (
        <div className="py-8 text-center text-sm text-neutral-400">Loading more...</div>
      )}

      {!hasMore && items.length > 0 && (
        <div className="py-8 text-center text-sm text-neutral-400">You&apos;re all caught up!</div>
      )}
    </div>
  );
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(dateStr).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function FeedCard({ item }: { item: FeedItem }) {
  const sellerHref = item.sellerProfileId ? `/seller/${item.sellerProfileId}` : "#";

  if (item.kind === "listing") {
    return (
      <div className="card-listing">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100">
          <span className="text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded">
            New Listing
          </span>
          <Link href={sellerHref} className="text-xs text-neutral-500 hover:underline">
            {item.sellerName}
          </Link>
          <span className="text-xs text-neutral-300 ml-auto">{timeAgo(item.date)}</span>
        </div>
        <Link href={`/listing/${item.id}`} className="block">
          {item.imageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.imageUrl} alt={item.title ?? ""} loading="lazy" className="w-full aspect-[4/3] object-cover" />
          )}
          <div className="p-4 bg-white">
            <p className="font-medium text-neutral-900">{item.title}</p>
            {item.priceCents != null && (
              <p className="text-sm text-neutral-600 mt-1">
                {(item.priceCents / 100).toLocaleString("en-US", {
                  style: "currency",
                  currency: item.currency ?? "USD",
                })}
              </p>
            )}
          </div>
        </Link>
      </div>
    );
  }

  if (item.kind === "blog") {
    return (
      <div className="card-listing">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100">
          <span className="text-xs font-medium text-indigo-700 bg-indigo-50 border border-indigo-200 px-2 py-0.5 rounded">
            New Post
          </span>
          <Link href={sellerHref} className="text-xs text-neutral-500 hover:underline">
            {item.sellerName}
          </Link>
          <span className="text-xs text-neutral-300 ml-auto">{timeAgo(item.date)}</span>
        </div>
        <Link href={`/blog/${item.slug}`} className="block">
          {item.coverImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={item.coverImageUrl} alt={item.title ?? ""} loading="lazy" className="w-full aspect-[4/3] object-cover" />
          )}
          <div className="p-4 bg-white">
            <p className="font-medium text-neutral-900">{item.title}</p>
            {item.excerpt && (
              <p className="text-sm text-neutral-500 mt-1 line-clamp-2">{item.excerpt}</p>
            )}
          </div>
        </Link>
      </div>
    );
  }

  if (item.kind === "broadcast") {
    return (
      <div className="card-section">
        <div className="flex items-center gap-2 px-4 py-2 border-b border-neutral-100">
          <span className="text-xs font-medium text-teal-700">Shop Update</span>
          <Link href={sellerHref} className="text-xs text-neutral-500 hover:underline">
            {item.sellerName}
          </Link>
          <span className="text-xs text-neutral-300 ml-auto">{timeAgo(item.date)}</span>
        </div>
        <div className="p-4">
          <p className="text-sm text-neutral-700">{item.message}</p>
          {item.broadcastImageUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.broadcastImageUrl}
              alt="Shop update"
              loading="lazy"
              className="mt-3 w-full aspect-[4/3] object-cover"
            />
          )}
        </div>
      </div>
    );
  }

  return null;
}
