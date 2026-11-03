"use client";
import * as React from "react";

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
  function handleClick() {
    fetch(`/api/listings/${listingId}/click`, { method: "POST" }).catch(() => {});
  }

  return (
    <li className={className} data-flip-id={flipId} onClick={handleClick}>
      {children}
    </li>
  );
}
