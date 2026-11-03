"use client";
import * as React from "react";
import { isListingNavigationHref } from "@/lib/listingClickTracking";

export default function ClickTracker({
  listingId,
  children,
  className,
  flipId,
}: {
  listingId: string;
  children: React.ReactNode;
  className?: string;
  // Lets a surrounding FlipList glide this card to its new spot.
  flipId?: string;
}) {
  function handleClick(event: React.MouseEvent<HTMLLIElement>) {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const link = target.closest<HTMLAnchorElement>("a[href]");
    if (!link || !event.currentTarget.contains(link)) return;
    if (!isListingNavigationHref(link.getAttribute("href"), window.location.href)) return;
    fetch(`/api/listings/${listingId}/click`, { method: "POST", keepalive: true }).catch(() => {});
  }

  return (
    <li className={className} data-flip-id={flipId} onClick={handleClick}>
      {children}
    </li>
  );
}
