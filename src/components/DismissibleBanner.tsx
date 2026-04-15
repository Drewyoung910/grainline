"use client";
import { useState } from "react";

const STORAGE_KEY = "dismissed-rejected-ids";

export default function DismissibleBanner({
  children,
  className = "",
  rejectedIds = [],
}: {
  children: React.ReactNode;
  className?: string;
  rejectedIds?: string[];
}) {
  const [dismissed, setDismissed] = useState(() => {
    if (typeof window === "undefined" || rejectedIds.length === 0) return false;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return false;
      const dismissedIds = JSON.parse(stored) as string[];
      return rejectedIds.every((id) => dismissedIds.includes(id));
    } catch {
      return false;
    }
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(rejectedIds));
    } catch { /* non-fatal */ }
    setDismissed(true);
  };

  return (
    <div className={`relative ${className}`}>
      {children}
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 text-neutral-400 hover:text-neutral-600 text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
