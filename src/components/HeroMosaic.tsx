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
      {/* Dark overlay — ensures white text readable over any photo */}
      <div className="absolute inset-0 bg-gradient-to-b from-amber-950/60 via-amber-900/40 to-amber-950/60 z-10" />

      {/* Row 1 — scrolls left */}
      <div
        className="absolute top-0 left-0 h-1/2 flex gap-px animate-scroll-left"
        style={{ width: "200%" }}
      >
        {row1.map((item, i) => (
          // eslint-disable-next-line jsx-a11y/anchor-is-valid
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
              loading="eager"
            />
          </a>
        ))}
      </div>

      {/* Row 2 — scrolls right */}
      <div
        className="absolute bottom-0 left-0 h-1/2 flex gap-px animate-scroll-right"
        style={{ width: "200%" }}
      >
        {row2.map((item, i) => (
          // eslint-disable-next-line jsx-a11y/anchor-is-valid
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
              loading="eager"
            />
          </a>
        ))}
      </div>
    </div>
  );
}
