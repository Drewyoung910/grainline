import Image from "next/image";

/**
 * Decorative homepage hero collage. Rendered as an `absolute inset-0`
 * background behind the left-anchored hero copy in `page.tsx`.
 *
 * Structure (three layers, painted back-to-front):
 *   1. BASE_TILES  — a size-varied grid with clean, uniform gutters. No tile
 *      overlaps another here, so the grid can never collide or form concave
 *      "interior corner" notches. Variety comes from span recipes, not native
 *      aspect ratio (all source photos are ~4:3).
 *   2. OVERLAP_TILES — 1–2 tiles positioned absolutely so they intentionally
 *      float over a seam in the base grid. Each carries a cream cutout ring
 *      (`ring-[6px] ring-[#F7F5F0]`, matching the page background) plus a soft
 *      shadow, so the overlap reads as one tile floating above another instead
 *      of a messy concave junction. This is how the interior corners are
 *      "handled" — the ring replaces the notch with a clean cream halo.
 *   3. WASH — a left-anchored horizontal gradient that fades to fully
 *      transparent, keeping the headline crisp while the right side of the
 *      collage stays bright. It must never fade into the header or stats bar.
 *
 * Everything here is decorative: `aria-hidden`, empty alt text, and no
 * interactive elements. The nearby hero heading/CTAs carry the semantics.
 *
 * To retune the look, edit the arrays below — positions are centralized here,
 * not scattered across the render.
 */

type Tile = {
  src: string;
  /** Responsive grid-area classes (mobile 6-col / lg 12-col). */
  area: string;
  /** object-position for the crop. */
  position: string;
};

type OverlapTile = {
  src: string;
  /** Absolute placement over the base grid (mobile + lg). */
  box: string;
  position: string;
};

// Base grid — clean gutters, no overlaps. Mobile shows 6 tiles; lg fills 12×6.
const BASE_TILES: Tile[] = [
  {
    src: "/hero/walnut-cabinet.webp",
    area: "col-start-1 col-span-3 row-start-1 row-span-3 lg:col-start-1 lg:col-span-4 lg:row-start-1 lg:row-span-4",
    position: "object-center",
  },
  {
    src: "/hero/maple-cabinet-detail.webp",
    area: "col-start-4 col-span-3 row-start-1 row-span-2 lg:col-start-5 lg:col-span-4 lg:row-start-1 lg:row-span-2",
    position: "object-[48%_center]",
  },
  {
    src: "/hero/geometric-cutting-board.webp",
    area: "col-start-4 col-span-3 row-start-3 row-span-2 lg:col-start-9 lg:col-span-4 lg:row-start-1 lg:row-span-3",
    position: "object-center",
  },
  {
    src: "/hero/drawer-detail.webp",
    area: "col-start-1 col-span-3 row-start-4 row-span-3 lg:col-start-5 lg:col-span-2 lg:row-start-3 lg:row-span-2",
    position: "object-[52%_72%]",
  },
  {
    src: "/hero/outdoor-planters.webp",
    area: "col-start-4 col-span-3 row-start-5 row-span-2 lg:col-start-1 lg:col-span-3 lg:row-start-5 lg:row-span-2",
    position: "object-center",
  },
  {
    src: "/hero/pencil-box-process.webp",
    area: "hidden lg:block lg:col-start-7 lg:col-span-2 lg:row-start-3 lg:row-span-2",
    position: "object-[62%_center]",
  },
  {
    src: "/hero/shelf-detail.webp",
    area: "hidden lg:block lg:col-start-4 lg:col-span-3 lg:row-start-5 lg:row-span-2",
    position: "object-center",
  },
  {
    src: "/hero/seated-desk.webp",
    area: "hidden lg:block lg:col-start-9 lg:col-span-2 lg:row-start-4 lg:row-span-3",
    position: "object-[50%_64%]",
  },
  {
    src: "/hero/dj-console.webp",
    area: "hidden lg:block lg:col-start-7 lg:col-span-2 lg:row-start-5 lg:row-span-2",
    position: "object-[50%_56%]",
  },
  {
    src: "/hero/maple-desk.webp",
    area: "hidden lg:block lg:col-start-11 lg:col-span-2 lg:row-start-4 lg:row-span-3",
    position: "object-[50%_62%]",
  },
];

// Floating accents — intentional overlap, cream cutout ring handles the corners.
// dj-console-lifestyle is portrait (contrast to the ~4:3 grid); placed right of
// center so the left wash never washes it out.
const OVERLAP_TILES: OverlapTile[] = [
  {
    src: "/hero/dj-console-lifestyle.webp",
    box: "right-[5%] top-[30%] h-[40%] w-[34%] sm:right-[7%] sm:w-[26%] lg:right-[23%] lg:top-[24%] lg:h-[48%] lg:w-[14%]",
    position: "object-[50%_55%]",
  },
  {
    src: "/hero/purpleheart-tray.webp",
    box: "hidden lg:block lg:left-[39%] lg:top-[6%] lg:h-[34%] lg:w-[12%]",
    position: "object-center",
  },
];

export default function HeroMosaic() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-x-3 top-3 bottom-0 sm:inset-x-5 sm:top-4 lg:inset-x-8">
        <div className="relative mx-auto h-full max-w-[1540px]">
          {/* Layer 1: base grid */}
          <div className="grid h-full grid-cols-6 grid-rows-[repeat(6,minmax(0,1fr))] gap-2 sm:gap-2.5 lg:grid-cols-12 lg:grid-rows-6">
            {BASE_TILES.map((tile, index) => (
              <div
                key={`hero-base-${index}`}
                className={`${tile.area} relative min-h-0 overflow-hidden rounded-lg bg-[#EFEAE0]`}
              >
                <Image
                  src={tile.src}
                  alt=""
                  fill
                  sizes="(max-width: 1023px) 50vw, 25vw"
                  loading={index < 5 ? "eager" : "lazy"}
                  fetchPriority={index < 3 ? "high" : "auto"}
                  className={`object-cover ${tile.position}`}
                />
              </div>
            ))}
          </div>

          {/* Layer 2: floating overlap accents with cream cutout rings */}
          {OVERLAP_TILES.map((tile, index) => (
            <div
              key={`hero-overlap-${index}`}
              className={`${tile.box} absolute z-10 overflow-hidden rounded-lg bg-[#EFEAE0] ring-[6px] ring-[#F7F5F0] shadow-[0_14px_34px_rgba(44,31,26,0.18)]`}
            >
              <Image
                src={tile.src}
                alt=""
                fill
                sizes="(max-width: 1023px) 34vw, 14vw"
                loading="lazy"
                className={`object-cover ${tile.position}`}
              />
            </div>
          ))}
        </div>
      </div>

      {/* Layer 3: left wash — fades to fully transparent, never into header/stats */}
      <div className="absolute inset-y-0 left-0 z-20 w-[80%] bg-[linear-gradient(90deg,#F7F5F0_0%,rgba(247,245,240,0.88)_26%,rgba(247,245,240,0.5)_54%,rgba(247,245,240,0.18)_78%,rgba(247,245,240,0)_100%)] sm:w-[68%] lg:w-[56%]" />
    </div>
  );
}
