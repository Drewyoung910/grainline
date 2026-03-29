"use client";
import * as React from "react";

export default function ClickTracker({
  listingId,
  children,
  className,
}: {
  listingId: string;
  children: React.ReactNode;
  className?: string;
}) {
  function handleClick() {
    fetch(`/api/listings/${listingId}/click`, { method: "POST" }).catch(() => {});
  }

  return (
    <li className={className} onClick={handleClick}>
      {children}
    </li>
  );
}
