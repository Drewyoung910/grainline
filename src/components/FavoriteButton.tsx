// src/components/FavoriteButton.tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useToast } from "@/components/Toast";

// Burst dot end positions (px from the heart's center), one ring of eight.
const HEART_BURST_OFFSETS: ReadonlyArray<readonly [number, number]> = [
  [0, -23], [16, -16], [23, 0], [16, 16], [0, 23], [-16, 16], [-23, 0], [-16, -16],
];

export default function FavoriteButton({
  listingId,
  initialSaved,
  size = 20,
}: {
  listingId: string;
  initialSaved: boolean;
  size?: number;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [isPending, startTransition] = useTransition();
  // Increments each time the visitor saves, restarting the pop and burst.
  const [popCount, setPopCount] = useState(0);
  const { toast } = useToast();

  const toggle = () => {
    if (isPending) return;

    const next = !saved;
    setSaved(next); // optimistic
    if (next) setPopCount((count) => count + 1);

    startTransition(async () => {
      try {
        const res = next
          ? await fetch("/api/favorites", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ listingId }),
            })
          : await fetch(`/api/favorites/${listingId}`, { method: "DELETE" });

        if (res.status === 401) {
          // send to sign-in and preserve location
          const url = new URL(window.location.href);
          window.location.href = `/sign-in?redirect_url=${encodeURIComponent(
            url.pathname + url.search
          )}`;
          return;
        }

        if (!res.ok) {
          // revert on error
          setSaved(!next);
          const data = await res.json().catch(() => null) as { error?: string } | null;
          console.error("Favorite failed:", data?.error ?? res.statusText);
          toast(data?.error ?? "Couldn’t update favorites. Please try again.", "error");
        }
      } catch (err) {
        setSaved(!next);
        console.error(err);
        toast("Network error. Please try again.", "error");
      }
    });
  };

  const heartPath =
    "M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3A5.5 5.5 0 0 0 2 8.5c0 3.78 3.4 6.86 8.55 11.54l.95.86.95-.86C18.6 15.36 22 12.28 22 8.5A5.5 5.5 0 0 0 16.5 3z";

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-busy={isPending || undefined}
      aria-label={saved ? "Remove from favorites" : "Save to favorites"}
      title={saved ? "Saved" : "Save"}
      onClick={toggle}
      className="group absolute right-0 top-0 z-10 inline-flex h-11 w-11 items-center justify-center rounded-full focus-visible:outline-none"
      style={{ lineHeight: 0 }}
    >
      {/* Solid white circle keeps the heart readable on any photo. It stays
          put when tapped; only the heart inside pops. The 44px button is the
          tap target; the visible circle is smaller so it clears the photo
          edges. */}
      <span
        aria-hidden="true"
        className="absolute h-9 w-9 rounded-full bg-white/95 shadow-[0_4px_14px_-6px_rgba(0,0,0,0.45)] transition-[background-color,scale] duration-150 ease-out group-hover:bg-white motion-safe:group-active:scale-[0.92] group-focus-visible:ring-2 group-focus-visible:ring-neutral-900/40"
      />
      {popCount > 0 && (
        <span key={`burst-${popCount}`} aria-hidden="true" className="pointer-events-none absolute inset-0">
          {HEART_BURST_OFFSETS.map(([x, y]) => (
            <span
              key={`${x},${y}`}
              className="heart-burst-dot"
              style={{ "--burst-x": `${x}px`, "--burst-y": `${y}px` } as CSSProperties}
            />
          ))}
        </span>
      )}
      <svg
        key={`heart-${popCount}`}
        width={size - 2}
        height={size - 2}
        viewBox="0 0 24 24"
        aria-hidden="true"
        className={`relative mt-px overflow-visible${popCount > 0 ? " heart-pop" : ""}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d={heartPath}
          strokeWidth={1.8}
          strokeLinejoin="round"
          className={`transition-[fill,stroke] duration-200 ${
            saved ? "fill-red-500 stroke-red-500" : "fill-transparent stroke-neutral-900"
          }`}
        />
      </svg>
    </button>
  );
}
