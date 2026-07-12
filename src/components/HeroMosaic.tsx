type PhotoItem = {
  url: string;
  listingId: string;
  title: string;
};

type Props = {
  photos: PhotoItem[];
};

const HERO_TILE_CLASSES = [
  "col-span-2 row-span-2 -translate-y-3 sm:-translate-y-5 lg:col-span-2 lg:row-span-2",
  "col-span-4 row-span-3 lg:col-span-4 lg:row-span-3",
  "col-span-3 row-span-2 translate-y-2 lg:col-span-3 lg:row-span-2",
  "col-span-3 row-span-3 -translate-y-1 lg:col-span-3 lg:row-span-3",
  "col-span-3 row-span-2 lg:col-span-3 lg:row-span-2",
  "col-span-3 row-span-2 translate-y-4 lg:col-span-2 lg:row-span-2",
  "col-span-3 row-span-2 -translate-y-2 lg:col-span-3 lg:row-span-2",
  "col-span-3 row-span-2 translate-y-3 lg:col-span-3 lg:row-span-2",
  "col-span-3 row-span-2 lg:col-span-2 lg:row-span-2",
  "col-span-3 row-span-2 translate-y-5 lg:col-span-4 lg:row-span-2",
] as const;

const HERO_TILE_SIZES = [
  { width: 320, height: 260 },
  { width: 720, height: 480 },
  { width: 520, height: 280 },
  { width: 520, height: 420 },
  { width: 520, height: 300 },
  { width: 340, height: 300 },
  { width: 520, height: 300 },
  { width: 520, height: 300 },
  { width: 340, height: 300 },
  { width: 720, height: 300 },
] as const;

export default function HeroMosaic({ photos }: Props) {
  const tiles = photos.slice(0, HERO_TILE_CLASSES.length);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-x-3 top-2 bottom-0 sm:inset-x-6 sm:top-4 lg:inset-x-8">
        <div className="grid h-full grid-cols-6 grid-rows-8 gap-2 sm:gap-3 lg:grid-cols-12 lg:grid-rows-5">
          {tiles.map((item, index) => {
            const tileClass = HERO_TILE_CLASSES[index] ?? HERO_TILE_CLASSES[0];
            const size = HERO_TILE_SIZES[index] ?? HERO_TILE_SIZES[0];
            return (
              <div
                key={`tile-${item.listingId}-${index}`}
                className={`${tileClass} min-h-0 overflow-hidden rounded-lg bg-[#EFEAE0] shadow-[0_10px_30px_rgba(28,25,23,0.10)] ring-1 ring-white/50`}
              >
                {/* Decorative marketplace imagery; nearby text provides the semantic hero content. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={item.url}
                  alt=""
                  width={size.width}
                  height={size.height}
                  loading={index < 5 ? "eager" : "lazy"}
                  fetchPriority={index < 3 ? "high" : "auto"}
                  decoding="async"
                  className="h-full w-full object-cover"
                />
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute inset-y-0 left-0 w-[88%] bg-[linear-gradient(90deg,#F7F5F0_0%,rgba(247,245,240,0.98)_18%,rgba(247,245,240,0.86)_39%,rgba(247,245,240,0.52)_63%,rgba(247,245,240,0.12)_100%)] sm:w-[76%] lg:w-[62%]" />
      <div className="absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-[#F7F5F0] to-transparent" />
      <div className="absolute inset-x-0 bottom-0 h-24 bg-gradient-to-t from-[#F7F5F0] to-transparent" />
    </div>
  );
}
