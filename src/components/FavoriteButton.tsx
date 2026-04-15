// src/components/FavoriteButton.tsx
"use client";

import { useState, useTransition } from "react";

export default function FavoriteButton({
  listingId,
  initialSaved,
  size = 28,
}: {
  listingId: string;
  initialSaved: boolean;
  size?: number;
}) {
  const [saved, setSaved] = useState(initialSaved);
  const [isPending, startTransition] = useTransition();

  const toggle = () => {
    if (isPending) return;

    const next = !saved;
    setSaved(next); // optimistic

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
          const msg = await res.text();
          console.error("Favorite failed:", msg);
          alert("Couldn’t update favorites. Please try again.");
        }
      } catch (err) {
        setSaved(!next);
        console.error(err);
        alert("Network error. Please try again.");
      }
    });
  };

  return (
    <button
      type="button"
      aria-pressed={saved}
      aria-label={saved ? "Remove from favorites" : "Save to favorites"}
      title={saved ? "Saved" : "Save"}
      onClick={toggle}
      disabled={isPending}
      className="absolute right-3 top-3 z-10"
      style={{ lineHeight: 0 }}
    >
      {/* Heart icon — filled grey background for visibility on all photos */}
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className="drop-shadow-[0_1px_3px_rgba(0,0,0,0.4)]"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Grey heart background for contrast on light photos */}
        <path
          fill="rgba(0,0,0,0.25)"
          d="M12 21s-1-.6-2.1-1.5C6.3 16.8 2 13.7 2 9.5 2 7 4 5 6.5 5c1.7 0 3.3.9 4.1 2.3C11.2 5.9 12.8 5 14.5 5 17 5 19 7 19 9.5c0 4.2-4.3 7.3-7.9 10C13 20.4 12 21 12 21z"
        />
        {saved ? (
          <path
            fill="currentColor"
            className="text-red-500"
            d="M12 21s-1-.6-2.1-1.5C6.3 16.8 2 13.7 2 9.5 2 7 4 5 6.5 5c1.7 0 3.3.9 4.1 2.3C11.2 5.9 12.8 5 14.5 5 17 5 19 7 19 9.5c0 4.2-4.3 7.3-7.9 10C13 20.4 12 21 12 21z"
          />
        ) : (
          <path
            fill="white"
            d="M16.5 3c-1.74 0-3.41.81-4.5 2.09C10.91 3.81 9.24 3 7.5 3A5.5 5.5 0 0 0 2 8.5c0 3.78 3.4 6.86 8.55 11.54l.95.86.95-.86C18.6 15.36 22 12.28 22 8.5A5.5 5.5 0 0 0 16.5 3zM12 18.55C7.14 14.24 4 11.39 4 8.5A3.5 3.5 0 0 1 7.5 5c1.54 0 3.04.99 3.57 2.36h1.87C13.46 5.99 14.96 5 16.5 5A3.5 3.5 0 0 1 20 8.5c0 2.89-3.14 5.74-8 10.05z"
          />
        )}
      </svg>
    </button>
  );
}



