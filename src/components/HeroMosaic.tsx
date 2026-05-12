"use client";

import { useEffect, useState } from "react";
import { publicListingPath } from "@/lib/publicPaths";

type PhotoItem = {
  url: string;
  listingId: string;
  title: string;
};

type Props = {
  photos: PhotoItem[];
};

export default function HeroMosaic({ photos }: Props) {
  const [paused, setPaused] = useState(false);
  // Random animation-delay (negative) so each visit starts mid-loop instead of
  // always at translateX(0). Applied via useEffect to avoid hydration mismatch.
  const [delays, setDelays] = useState<{ row1: string; row2: string }>({
    row1: "0s",
    row2: "0s",
  });

  useEffect(() => {
    // Negative animation-delay seeks into the loop. 40s duration = pick a random
    // offset within the cycle so first paint shows a non-zero scroll position.
    const row1Offset = Math.random() * 40;
    const row2Offset = Math.random() * 38; // slightly different range so rows desync
    setDelays({ row1: `-${row1Offset.toFixed(2)}s`, row2: `-${row2Offset.toFixed(2)}s` });
  }, []);

  const mid = Math.ceil(photos.length / 2);
  const row1Base = photos.slice(0, mid);
  const row2Base = photos.slice(mid);

  // Duplicate for seamless CSS loop
  const row1 = [...row1Base, ...row1Base];
  const row2 = [...row2Base, ...row2Base];

  // Use animation-play-state to pause/resume so the current scroll position is
  // preserved instead of restarting from translateX(0).
  const row1Style: React.CSSProperties = {
    animationDelay: delays.row1,
    animationPlayState: paused ? "paused" : "running",
    // Slightly different duration so the two rows don't sync up over time
    animationDuration: "40s",
  };
  const row2Style: React.CSSProperties = {
    animationDelay: delays.row2,
    animationPlayState: paused ? "paused" : "running",
    animationDuration: "44s",
  };

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Top fade — blends into header */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-white/50 to-transparent z-20" />
      {/* Bottom fade — blends into stats bar */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#F7F5F0]/60 to-transparent z-20" />
      {/* Light warm overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-amber-900/20 via-amber-800/10 to-amber-900/20 z-10" />

      {/* Row 1 — scrolls left */}
      <div
        className="absolute top-0 left-0 h-1/2 flex gap-0 w-max animate-scroll-left motion-reduce:animate-none"
        style={row1Style}
      >
        {row1.map((item, i) => (
          <a
            key={`r1-${item.listingId}-${i}`}
            href={publicListingPath(item.listingId, item.title)}
            className="flex-none w-64 h-full overflow-hidden block"
            tabIndex={-1}
            aria-hidden="true"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt=""
              className="w-full h-full object-cover blur-[4px] scale-105 motion-reduce:blur-none motion-reduce:scale-100"
              loading={i < 4 ? "eager" : "lazy"}
              fetchPriority={i < 4 ? "high" : "auto"}
              decoding="async"
            />
          </a>
        ))}
      </div>

      {/* Row 2 — scrolls right */}
      <div
        className="absolute bottom-0 left-0 h-1/2 flex gap-0 w-max animate-scroll-right motion-reduce:animate-none"
        style={row2Style}
      >
        {row2.map((item, i) => (
          <a
            key={`r2-${item.listingId}-${i}`}
            href={publicListingPath(item.listingId, item.title)}
            className="flex-none w-64 h-full overflow-hidden block"
            tabIndex={-1}
            aria-hidden="true"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt=""
              className="w-full h-full object-cover blur-[4px] scale-105 motion-reduce:blur-none motion-reduce:scale-100"
              loading={i < 4 ? "eager" : "lazy"}
              fetchPriority={i < 4 ? "high" : "auto"}
              decoding="async"
            />
          </a>
        ))}
      </div>

      <button
        type="button"
        onClick={() => setPaused((value) => !value)}
        aria-label={paused ? "Play hero animation" : "Pause hero animation"}
        aria-pressed={paused}
        className="absolute bottom-4 right-4 z-30 inline-flex h-10 min-w-10 items-center justify-center rounded-full bg-black/55 px-3 text-xs font-semibold text-white shadow-sm transition-colors hover:bg-black/70 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
      >
        <span aria-hidden="true">{paused ? ">" : "||"}</span>
      </button>
    </div>
  );
}
