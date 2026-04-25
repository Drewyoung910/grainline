"use client";

type PhotoItem = {
  url: string;
  listingId: string;
};

type Props = {
  photos: PhotoItem[];
};

export default function HeroMosaic({ photos }: Props) {
  const mid = Math.ceil(photos.length / 2);
  const row1Base = photos.slice(0, mid);
  const row2Base = photos.slice(mid);

  // Duplicate for seamless CSS loop
  const row1 = [...row1Base, ...row1Base];
  const row2 = [...row2Base, ...row2Base];

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
        className="absolute top-0 left-0 h-1/2 flex gap-0 animate-scroll-left motion-reduce:animate-none w-max"
      >
        {row1.map((item, i) => (
          <a
            key={i}
            href={`/listing/${item.listingId}`}
            className="flex-none w-64 h-full overflow-hidden block"
            tabIndex={-1}
            aria-hidden="true"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt=""
              className="w-full h-full object-cover blur-[4px] scale-105"
              loading={i < 5 ? "eager" : "lazy"}
            />
          </a>
        ))}
      </div>

      {/* Row 2 — scrolls right */}
      <div
        className="absolute bottom-0 left-0 h-1/2 flex gap-0 animate-scroll-right motion-reduce:animate-none w-max"
      >
        {row2.map((item, i) => (
          <a
            key={i}
            href={`/listing/${item.listingId}`}
            className="flex-none w-64 h-full overflow-hidden block"
            tabIndex={-1}
            aria-hidden="true"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={item.url}
              alt=""
              className="w-full h-full object-cover blur-[4px] scale-105"
              loading={i < 5 ? "eager" : "lazy"}
            />
          </a>
        ))}
      </div>
    </div>
  );
}
