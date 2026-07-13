type PhotoItem = {
  url: string;
  listingId: string;
  title: string;
};

type Props = {
  photos: PhotoItem[];
};

const HERO_DESKTOP_TILE_CLASSES = [
  "lg:left-[0%] lg:top-[12%] lg:h-[25%] lg:w-[17%] lg:z-[2]",
  "lg:left-[10%] lg:top-[0%] lg:h-[39%] lg:w-[30%] lg:z-[4]",
  "lg:left-[38.5%] lg:top-[3%] lg:h-[25%] lg:w-[21%] lg:z-[3]",
  "lg:left-[57.5%] lg:top-[0%] lg:h-[39%] lg:w-[29%] lg:z-[2]",
  "lg:left-[82.5%] lg:top-[13%] lg:h-[28%] lg:w-[17.5%] lg:z-[5]",
  "lg:left-[0%] lg:top-[35%] lg:h-[31%] lg:w-[25%] lg:z-[6]",
  "lg:left-[21.5%] lg:top-[37%] lg:h-[36%] lg:w-[24.5%] lg:z-[3]",
  "lg:left-[43.5%] lg:top-[29%] lg:h-[27%] lg:w-[26%] lg:z-[5]",
  "lg:left-[0%] lg:top-[61%] lg:h-[39%] lg:w-[31%] lg:z-[4]",
  "lg:left-[28%] lg:top-[54%] lg:h-[46%] lg:w-[72%] lg:z-[1]",
] as const;

const HERO_MOBILE_TILE_CLASSES = [
  "left-[0%] top-[4%] h-[17%] w-[40%] z-[3]",
  "left-[33%] top-[0%] h-[25%] w-[67%] z-[2]",
  "left-[0%] top-[20%] h-[27%] w-[53%] z-[5]",
  "left-[47%] top-[23%] h-[25%] w-[53%] z-[3]",
  "left-[7%] top-[45%] h-[27%] w-[44%] z-[4]",
  "left-[47%] top-[46%] h-[28%] w-[53%] z-[5]",
  "left-[0%] top-[69%] h-[31%] w-[61%] z-[3]",
  "left-[55%] top-[71%] h-[29%] w-[45%] z-[4]",
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
  const tiles = photos.slice(0, HERO_DESKTOP_TILE_CLASSES.length);

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-x-7 top-3 bottom-0 sm:inset-x-10 sm:top-4 lg:inset-x-5">
        <div className="relative mx-auto h-full max-w-[1580px]">
          {tiles.map((item, index) => {
            const desktopClass = HERO_DESKTOP_TILE_CLASSES[index] ?? HERO_DESKTOP_TILE_CLASSES[0];
            const mobileClass = HERO_MOBILE_TILE_CLASSES[index];
            const size = HERO_TILE_SIZES[index] ?? HERO_TILE_SIZES[0];
            const baseClass = "absolute rounded-[14px] bg-[#F7F5F0] p-[3px]";
            const tile = (
              <>
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
                  className="h-full w-full rounded-lg object-cover"
                />
              </>
            );

            return mobileClass ? (
              <div key={`tile-${item.listingId}-${index}`} className={`${baseClass} ${mobileClass} ${desktopClass}`}>
                {tile}
              </div>
            ) : (
              <div key={`tile-${item.listingId}-${index}`} className={`${baseClass} hidden lg:block ${desktopClass}`}>
                {tile}
              </div>
            );
          })}
        </div>
      </div>

      <div className="absolute inset-y-0 left-0 w-[80%] bg-[linear-gradient(90deg,#F7F5F0_0%,rgba(247,245,240,0.88)_24%,rgba(247,245,240,0.56)_52%,rgba(247,245,240,0.22)_78%,rgba(247,245,240,0)_100%)] sm:w-[66%] lg:w-[56%]" />
    </div>
  );
}
