// src/components/HeroCollage.tsx
// DREW-APPROVED HERO DESIGN (2026-07-11, v2 per Drew's feedback): the hero
// is a SPLIT EDITORIAL layout — headline + search left, and this photo WALL
// as the right grid column. With six photos in three dense columns the
// imagery reads as rich texture (individual photo quality matters less),
// which is what the old moving mosaic provided without its jank. Cards are
// REAL LINKS to their listings (alt = title). Do NOT convert this into an
// aria-hidden background layer or a dark-overlay hero — rejected concepts.
// Server component: no client JS, no rotation, no marquee motion.
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
      className={`group block overflow-hidden rounded-2xl bg-white shadow-md ring-1 ring-black/5 ${className}`}
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

  // Soft warm glow behind the wall (decorative only)
  const glow = (
    <div
      aria-hidden="true"
      className="absolute -inset-8 rounded-[3rem] bg-amber-200/25 blur-2xl"
    />
  );

  if (items.length >= 6) {
    const [a, b, c, d, e, f] = items;
    return (
      <div className="relative w-full">
        {glow}
        {/* Three dense columns with a gentle masonry stagger */}
        <div className="relative grid grid-cols-3 gap-3 sm:gap-4">
          <div className="space-y-3 pt-8 sm:space-y-4 sm:pt-10">
            <CollageCard item={b} className="aspect-[4/5]" />
            <CollageCard item={e} className="aspect-square" />
          </div>
          <div className="space-y-3 sm:space-y-4">
            <CollageCard item={a} priority className="aspect-[4/5]" />
            <CollageCard item={f} className="aspect-[4/5]" />
          </div>
          <div className="space-y-3 pt-14 sm:space-y-4 sm:pt-20">
            <CollageCard item={c} className="aspect-square" />
            <CollageCard item={d} className="aspect-[4/5]" />
          </div>
        </div>
      </div>
    );
  }

  // 3-5 photos: two flush columns
  const [a, b, c] = items;
  return (
    <div className="relative mx-auto w-full max-w-[480px] lg:ml-auto lg:mr-0">
      {glow}
      <div className="relative grid grid-cols-2 gap-4 sm:gap-5">
        <div className="space-y-4 pt-10 sm:space-y-5 sm:pt-14">
          <CollageCard item={b} className="aspect-[4/5]" />
          <CollageCard item={c} className="aspect-square" />
        </div>
        <div>
          <CollageCard item={a} priority className="aspect-[4/5]" />
        </div>
      </div>
    </div>
  );
}
