type PhotoItem = {
  url: string;
  listingId: string;
  title: string;
};

type Props = {
  photos: PhotoItem[];
};

const HERO_TILE_CLASSES = [
  "col-span-2 row-span-2 lg:col-start-1 lg:col-span-2 lg:row-start-1 lg:row-span-2",
  "col-span-4 row-span-3 lg:col-start-3 lg:col-span-4 lg:row-start-1 lg:row-span-3",
  "col-span-3 row-span-2 lg:col-start-7 lg:col-span-3 lg:row-start-1 lg:row-span-2",
  "col-span-3 row-span-3 lg:col-start-10 lg:col-span-3 lg:row-start-1 lg:row-span-3",
  "col-span-3 row-span-3 lg:col-start-1 lg:col-span-3 lg:row-start-3 lg:row-span-3",
  "col-span-3 row-span-3 lg:col-start-4 lg:col-span-3 lg:row-start-4 lg:row-span-3",
  "col-span-3 row-span-2 lg:col-start-7 lg:col-span-3 lg:row-start-3 lg:row-span-2",
  "col-span-3 row-span-2 lg:col-start-10 lg:col-span-3 lg:row-start-4 lg:row-span-1",
  "hidden lg:block lg:col-start-1 lg:col-span-3 lg:row-start-6 lg:row-span-1",
  "hidden lg:block lg:col-start-7 lg:col-span-6 lg:row-start-5 lg:row-span-2",
] as const;

const HERO_TILE_SIZES = [
  { width: 420, height: 300 },
  { width: 700, height: 430 },
  { width: 520, height: 280 },
  { width: 500, height: 460 },
  { width: 620, height: 360 },
  { width: 600, height: 380 },
  { width: 520, height: 320 },
  { width: 400, height: 280 },
  { width: 420, height: 430 },
  { width: 560, height: 300 },
] as const;

export default function HeroMosaic({ photos }: Props) {
  const tiles = photos.slice(0, HERO_TILE_CLASSES.length);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-x-4 top-3 -bottom-1 sm:inset-x-6 sm:top-4 lg:inset-x-8">
        <div className="mx-auto grid h-full max-w-[1540px] grid-cols-6 grid-rows-8 gap-2.5 sm:gap-3 lg:grid-cols-12 lg:grid-rows-6 lg:gap-3.5">
          {tiles.map((item, index) => {
            const tileClass = HERO_TILE_CLASSES[index] ?? HERO_TILE_CLASSES[0];
            const size = HERO_TILE_SIZES[index] ?? HERO_TILE_SIZES[0];
            return (
              <div
                key={`tile-${item.listingId}-${index}`}
                className={`${tileClass} min-h-0 overflow-hidden rounded-lg bg-[#F7F5F0]`}
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

      <div className="absolute inset-y-0 left-0 w-[78%] bg-[linear-gradient(90deg,#F7F5F0_0%,rgba(247,245,240,0.86)_24%,rgba(247,245,240,0.48)_52%,rgba(247,245,240,0.18)_76%,rgba(247,245,240,0)_100%)] sm:w-[66%] lg:w-[56%]" />
    </div>
  );
}
