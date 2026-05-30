"use client";
import { useEffect, useState } from "react";

const STORAGE_KEY = "dismissed-rejected-ids";

function parseDismissedIds(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((id): id is string => typeof id === "string");
  } catch {
    return [];
  }
}

export default function DismissibleBanner({
  children,
  className = "",
  rejectedIds = [],
}: {
  children: React.ReactNode;
  className?: string;
  rejectedIds?: string[];
}) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    if (rejectedIds.length === 0) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const dismissedIds = parseDismissedIds(stored);
      setDismissed(rejectedIds.every((id) => dismissedIds.includes(id)));
    } catch {
      setDismissed(false);
    }
  }, [rejectedIds]);

  if (dismissed) return null;

  const handleDismiss = () => {
    try {
      if (rejectedIds.length > 0) {
        const stored = localStorage.getItem(STORAGE_KEY);
        const dismissedIds = parseDismissedIds(stored);
        localStorage.setItem(STORAGE_KEY, JSON.stringify([...new Set([...dismissedIds, ...rejectedIds])]));
      }
    } catch { /* non-fatal */ }
    setDismissed(true);
  };

  return (
    <div className={`relative ${className}`}>
      {children}
      <button
        onClick={handleDismiss}
        className="absolute top-2 right-2 text-neutral-500 hover:text-neutral-600 text-lg leading-none"
        aria-label="Dismiss"
      >
        ×
      </button>
    </div>
  );
}
