"use client";
import * as React from "react";
import { isListingNavigationHref } from "@/lib/listingClickTracking";

export default function ClickTracker({
  listingId,
  children,
  className,
}: {
  listingId: string;
  children: React.ReactNode;
  className?: string;
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
    <li className={className} onClick={handleClick}>
      {children}
    </li>
  );
}
