"use client";

import { useSyncExternalStore } from "react";

// The server cannot know the viewer's time zone, so server HTML and the
// hydration pass format in the marketplace's home zone (US-only, Texas-based).
// The client then re-renders in the viewer's own zone; client navigations
// render the local value immediately.
const SERVER_TIME_ZONE = "America/Chicago";

const subscribe = () => () => {};
const getClientSnapshot = () => true;
const getServerSnapshot = () => false;

function formatDate(parsed: Date, dateOnly: boolean, timeZone?: string) {
  return dateOnly
    ? parsed.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone })
    : parsed.toLocaleString("en-US", {
        month: "short",
        day: "numeric",
        year: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZone,
      });
}

export default function LocalDate({ date, dateOnly = false }: { date: string | Date; dateOnly?: boolean }) {
  const isClient = useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
  const parsed = new Date(date);
  if (Number.isNaN(parsed.getTime())) return null;

  // Same format on server and client; only the time zone can differ, and
  // suppressHydrationWarning covers engine-level Intl spacing differences.
  return (
    <time dateTime={parsed.toISOString()} suppressHydrationWarning>
      {formatDate(parsed, dateOnly, isClient ? undefined : SERVER_TIME_ZONE)}
    </time>
  );
}
