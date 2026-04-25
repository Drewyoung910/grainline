"use client";
import { useEffect, useState } from "react";

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
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setDismissed(false);
    if (rejectedIds.length === 0) return;
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (!stored) return;
      const dismissedIds = JSON.parse(stored) as string[];
      setDismissed(rejectedIds.every((id) => dismissedIds.includes(id)));
    } catch {
      setDismissed(false);
    }
  }, [rejectedIds]);

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
