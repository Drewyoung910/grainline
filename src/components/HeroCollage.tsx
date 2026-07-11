// Static decorative homepage hero background. It uses real listing photos but
// does not add extra links or custom motion inside the primary hero.
import MediaImage from "@/components/MediaImage";

export type HeroCollageItem = {
  listingId: string;
  title: string;
  url: string;
};

function CollagePanel({
  item,
  className,
  priority = false,
}: {
  item: HeroCollageItem;
  className: string;
  priority?: boolean;
}) {
  return (
    <div className={`overflow-hidden rounded-lg bg-neutral-900/30 ring-1 ring-white/10 ${className}`}>
      <MediaImage
        src={item.url}
        alt=""
        loading="eager"
        fetchPriority={priority ? "high" : "auto"}
        decoding="async"
        className="h-full w-full object-cover"
        fallbackClassName="h-full w-full bg-neutral-800"
      />
    </div>
  );
}

export default function HeroCollage({ items }: { items: HeroCollageItem[] }) {
  if (items.length < 3) return null;
  const [a, b, c] = items;

  return (
    <div aria-hidden="true" className="pointer-events-none absolute inset-0 overflow-hidden">
      <div className="absolute inset-0 flex h-full gap-2 p-2 opacity-85 sm:gap-3 sm:p-3">
        <CollagePanel
          item={b}
          className="mt-auto h-[82%] flex-1 -rotate-[1deg]"
        />
        <CollagePanel
          item={a}
          priority
          className="h-full flex-[1.15] rotate-[0.5deg]"
        />
        <CollagePanel
          item={c}
          className="h-[82%] flex-1 rotate-[1deg]"
        />
      </div>
    </div>
  );
}
