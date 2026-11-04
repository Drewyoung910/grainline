// src/components/FavoriteButton.tsx
"use client";

import { useState, useTransition, type CSSProperties } from "react";
import { useToast } from "@/components/Toast";
import { favoriteErrorMessage } from "@/lib/favoriteFeedback";
import { acceptTermsPathForRedirect } from "@/lib/internalReturnUrl";

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
          const data = await res.json().catch(() => null) as { error?: string; code?: string } | null;
          console.error("Favorite failed:", data?.error ?? res.statusText);
          if (data?.code === "TERMS_NOT_ACCEPTED") {
            window.location.href = acceptTermsPathForRedirect(
              window.location.pathname + window.location.search,
            );
            return;
          }
          toast(favoriteErrorMessage(res.status, data?.code), "error");
          return;
        }

        toast(next ? "Saved to favorites." : "Removed from favorites.", "success");
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
      data-saved={saved ? "true" : "false"}
      className="listing-save-control group/fav absolute right-0 top-0 z-10 inline-flex h-11 w-11 transform-gpu items-center justify-center rounded-full transition-[opacity,translate,scale] duration-200 ease-out focus-visible:outline-none"
      style={{ lineHeight: 0 }}
    >
      {/* A dark frosted circle keeps the heart readable on any photo. It stays
          put when tapped; only the heart inside pops. The 44px button is the
          tap target; the visible circle is smaller so it clears the photo
          edges. */}
      <span
        aria-hidden="true"
        className="absolute h-[34px] w-[34px] rounded-full bg-[#2C1F1A]/62 shadow-[0_6px_18px_-8px_rgba(20,13,10,0.9),0_0_0_1px_rgba(255,255,255,0.3)] backdrop-blur-md transition-[background-color,scale,box-shadow] duration-180 ease-out group-hover/fav:scale-[1.06] group-hover/fav:bg-[#2C1F1A]/74 group-hover/fav:shadow-[0_8px_22px_-9px_rgba(20,13,10,0.95),0_0_0_1px_rgba(255,255,255,0.38)] motion-safe:group-active/fav:scale-[0.94] group-focus-visible/fav:ring-2 group-focus-visible/fav:ring-white group-focus-visible/fav:ring-offset-2 group-focus-visible/fav:ring-offset-[#2C1F1A]"
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
        className={`relative block transform-gpu overflow-visible${popCount > 0 ? " heart-pop" : ""}`}
        xmlns="http://www.w3.org/2000/svg"
      >
        <path
          d={heartPath}
          strokeWidth={1.8}
          strokeLinejoin="round"
          className={`transition-[fill,stroke] duration-200 ${
            saved ? "fill-red-500 stroke-red-400" : "fill-transparent stroke-[#FBF8F3]"
          }`}
        />
      </svg>
    </button>
  );
}
