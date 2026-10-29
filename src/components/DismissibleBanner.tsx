"use client";
import { useState, useSyncExternalStore } from "react";
import { X } from "@/components/icons";

const STORAGE_KEY = "dismissed-rejected-ids";
const MAX_DISMISSED_REJECTED_IDS = 500;

function normalizeDismissedIds(ids: string[]): string[] {
  return [...new Set(ids)].slice(-MAX_DISMISSED_REJECTED_IDS);
}

function parseDismissedIds(stored: string | null): string[] {
  if (!stored) return [];
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!Array.isArray(parsed)) return [];
    return normalizeDismissedIds(parsed.filter((id): id is string => typeof id === "string"));
  } catch {
    return [];
  }
}

function isStoredDismissed(rejectedIds: string[]): boolean {
  if (rejectedIds.length === 0) return false;
  try {
    const dismissedIds = parseDismissedIds(localStorage.getItem(STORAGE_KEY));
    return rejectedIds.every((id) => dismissedIds.includes(id));
  } catch {
    return false;
  }
}

function subscribeToStorage(onChange: () => void) {
  window.addEventListener("storage", onChange);
  return () => window.removeEventListener("storage", onChange);
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
  // Dismissals live in localStorage, which the server cannot read. A banner
  // that can be dismissed by id stays hidden until the client has checked
  // storage, so a dismissed banner never flashes back on load. Banners without
  // ids render immediately, and client navigations read storage synchronously.
  const storedDismissed = useSyncExternalStore(
    subscribeToStorage,
    () => isStoredDismissed(rejectedIds),
    () => rejectedIds.length > 0,
  );
  const idsKey = JSON.stringify(rejectedIds);
  const [dismissedKey, setDismissedKey] = useState<string | null>(null);

  if (storedDismissed || dismissedKey === idsKey) return null;

  const handleDismiss = () => {
    try {
      if (rejectedIds.length > 0) {
        const stored = localStorage.getItem(STORAGE_KEY);
        const dismissedIds = parseDismissedIds(stored);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeDismissedIds([...dismissedIds, ...rejectedIds])));
      }
    } catch { /* non-fatal */ }
    setDismissedKey(idsKey);
  };

  return (
    <div className={`relative ${className}`}>
      {children}
      <button
        type="button"
        onClick={handleDismiss}
        className="absolute -right-1.5 -top-1.5 inline-flex h-11 w-11 items-center justify-center rounded-full opacity-70 transition-opacity hover:opacity-100"
        aria-label="Dismiss"
      >
        <X size={18} />
      </button>
    </div>
  );
}
