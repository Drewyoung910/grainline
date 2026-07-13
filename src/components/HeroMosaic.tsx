type PhotoItem = {
  url: string;
  listingId: string;
  title: string;
};

type Props = {
  photos: PhotoItem[];
};

const HERO_TILE_CLASSES = [
  "col-start-1 col-span-3 row-start-1 row-span-2 lg:col-start-1 lg:col-span-2 lg:row-start-1 lg:row-span-2",
  "col-start-4 col-span-5 row-start-1 row-span-3 lg:col-start-3 lg:col-span-4 lg:row-start-1 lg:row-span-3",
  "col-start-1 col-span-4 row-start-3 row-span-4 lg:col-start-7 lg:col-span-3 lg:row-start-1 lg:row-span-2",
  "col-start-5 col-span-4 row-start-4 row-span-2 lg:col-start-10 lg:col-span-3 lg:row-start-1 lg:row-span-3",
  "col-start-5 col-span-4 row-start-6 row-span-2 lg:col-start-1 lg:col-span-3 lg:row-start-3 lg:row-span-3",
  "col-start-1 col-span-3 row-start-7 row-span-4 lg:col-start-4 lg:col-span-3 lg:row-start-4 lg:row-span-3",
  "col-start-4 col-span-5 row-start-8 row-span-3 lg:col-start-7 lg:col-span-3 lg:row-start-3 lg:row-span-2",
  "hidden lg:block lg:col-start-10 lg:col-span-3 lg:row-start-4 lg:row-span-1",
  "hidden lg:block lg:col-start-1 lg:col-span-3 lg:row-start-6 lg:row-span-1",
  "hidden lg:block lg:col-start-7 lg:col-span-6 lg:row-start-5 lg:row-span-2",
] as const;

const HERO_TILE_SURFACE_CLASSES = [
  "absolute -left-1 -top-1 bottom-0 right-0 lg:-left-2",
  "absolute left-0 -top-0.5 bottom-0 right-0 lg:-top-2",
  "absolute -left-0.5 top-0 bottom-0 right-0 lg:left-0 lg:-top-1",
  "absolute left-0 -right-1 top-0 bottom-0 lg:-right-2 lg:-top-1",
  "absolute left-0 -right-0.5 top-0 bottom-0 lg:-left-2 lg:right-0",
  "absolute -left-1 top-0 bottom-0 right-0 lg:left-0",
  "absolute left-0 -right-1 top-0 bottom-0 lg:right-0",
  "absolute left-0 top-0 bottom-0 right-0 lg:-right-2",
  "absolute left-0 top-0 bottom-0 right-0 lg:-left-1",
  "absolute left-0 top-0 bottom-0 right-0 lg:-right-1",
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
      <div className="absolute inset-x-4 top-3 bottom-0 sm:inset-x-6 sm:top-4 lg:inset-x-8">
        <div className="mx-auto grid h-full max-w-[1540px] grid-cols-8 grid-rows-[repeat(10,minmax(0,1fr))] gap-1.5 sm:gap-2 lg:grid-cols-12 lg:grid-rows-6 lg:gap-2.5">
          {tiles.map((item, index) => {
            const tileClass = HERO_TILE_CLASSES[index] ?? HERO_TILE_CLASSES[0];
            const surfaceClass = HERO_TILE_SURFACE_CLASSES[index] ?? "absolute inset-0";
            const size = HERO_TILE_SIZES[index] ?? HERO_TILE_SIZES[0];
            return (
              <div
                key={`tile-${item.listingId}-${index}`}
                className={`${tileClass} relative min-h-0`}
              >
                <div className={`${surfaceClass} overflow-hidden rounded-lg bg-[#F7F5F0]`}>
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
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute inset-y-0 left-0 w-[78%] bg-[linear-gradient(90deg,#F7F5F0_0%,rgba(247,245,240,0.86)_24%,rgba(247,245,240,0.48)_52%,rgba(247,245,240,0.18)_76%,rgba(247,245,240,0)_100%)] sm:w-[66%] lg:w-[56%]" />
    </div>
  );
}
