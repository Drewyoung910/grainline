// src/components/HeroCollage.tsx
// DREW-APPROVED HERO DESIGN (2026-07-11): the homepage hero is a SPLIT
// EDITORIAL layout — headline + search on the left over the light cream
// wash, and this collage as the RIGHT GRID COLUMN: three sharp listing
// photos in the site's rounded-card language, gently staggered/rotated like
// pieces laid out on a workbench. The cards are REAL LINKS to their
// listings on purpose (sharp, clickable product photography is the point).
// Do NOT convert this into an aria-hidden background layer or pair it with
// a dark overlay hero — that is the rejected mosaic concept. Server
// component: no client JS, no motion beyond hover scale.
import Link from "next/link";
import MediaImage from "@/components/MediaImage";
import { publicListingPath } from "@/lib/publicPaths";

export type HeroCollageItem = {
  listingId: string;
  title: string;
  url: string;
};

function CollageCard({
  item,
  className,
  priority = false,
}: {
  item: HeroCollageItem;
  className: string;
  priority?: boolean;
}) {
  return (
    <Link
      href={publicListingPath(item.listingId, item.title)}
      className={`group block overflow-hidden rounded-2xl bg-white shadow-lg ring-1 ring-black/5 ${className}`}
    >
      <MediaImage
        src={item.url}
        alt={item.title}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : "auto"}
        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
        fallbackClassName="h-full w-full bg-gradient-to-br from-amber-50 to-stone-100"
      />
    </Link>
  );
}

export default function HeroCollage({ items }: { items: HeroCollageItem[] }) {
  if (items.length < 3) return null;
  const [a, b, c] = items;

  return (
    <div className="relative mx-auto w-full max-w-[480px] lg:ml-auto lg:mr-0">
      {/* Soft warm glow behind the collage (decorative only) */}
      <div
        aria-hidden="true"
        className="absolute -inset-8 rounded-[3rem] bg-amber-200/25 blur-2xl"
      />
      <div className="relative grid grid-cols-2 gap-4 sm:gap-5">
        {/* Left column — starts lower for the staggered workbench look */}
        <div className="space-y-4 pt-10 sm:space-y-5 sm:pt-14">
          <CollageCard item={b} className="aspect-[4/5] -rotate-[1.5deg]" />
          <CollageCard item={c} className="aspect-square rotate-[1deg]" />
        </div>
        {/* Right column — hero piece */}
        <div>
          <CollageCard item={a} priority className="aspect-[4/5] rotate-[1.5deg]" />
        </div>
      </div>
    </div>
  );
}
