"use client";

import { useState } from "react";
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
  const mid = Math.ceil(photos.length / 2);
  const row1Base = photos.slice(0, mid);
  const row2Base = photos.slice(mid);

  // Duplicate for seamless CSS loop
  const row1 = [...row1Base, ...row1Base];
  const row2 = [...row2Base, ...row2Base];
  const row1Class = `absolute top-0 left-0 h-1/2 flex gap-0 w-max ${
    paused ? "" : "animate-scroll-left motion-reduce:animate-none"
  }`;
  const row2Class = `absolute bottom-0 left-0 h-1/2 flex gap-0 w-max ${
    paused ? "" : "animate-scroll-right motion-reduce:animate-none"
  }`;

  return (
    <div className="absolute inset-0 overflow-hidden">
      {/* Top fade — blends into header */}
      <div className="absolute top-0 left-0 right-0 h-32 bg-gradient-to-b from-white/50 to-transparent z-20" />
      {/* Bottom fade — blends into stats bar */}
      <div className="absolute bottom-0 left-0 right-0 h-24 bg-gradient-to-t from-[#F7F5F0]/60 to-transparent z-20" />
      {/* Light warm overlay */}
      <div className="absolute inset-0 bg-gradient-to-b from-amber-900/20 via-amber-800/10 to-amber-900/20 z-10" />

      {/* Row 1 — scrolls left */}
      <div className={row1Class}>
        {row1.map((item, i) => (
          <a
            key={`${item.listingId}-${item.url}-${i}`}
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
              loading={i < 5 ? "eager" : "lazy"}
            />
          </a>
        ))}
      </div>

      {/* Row 2 — scrolls right */}
      <div className={row2Class}>
        {row2.map((item, i) => (
          <a
            key={`${item.listingId}-${item.url}-${i}`}
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
              loading={i < 5 ? "eager" : "lazy"}
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
