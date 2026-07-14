import Image from "next/image";
import type { CSSProperties } from "react";

/**
 * Decorative homepage hero collage — an overlapping matted-photo layout with
 * computed concave "inner corner" notches at every intersection.
 *
 * Each photo is an independently positioned rounded rectangle (percent geometry)
 * with a consistent cream mat (`border-[#F7F5F0]`) and a soft shadow, stacked by
 * z-index like a pile of prints. Convex corners round themselves via
 * `border-radius`.
 *
 * The hard part is the CONCAVE corners: where a higher card's straight edge
 * crosses a lower photo's edge (a T-junction), the negative space forms a sharp
 * 90° inside corner that `border-radius` cannot touch. We fix these by MASKING
 * the underlying photo: for every point where a higher tile's edge crosses this
 * tile's edge, we subtract a radial-gradient disc of `--inner-radius`, carving a
 * clean quarter-circle notch that reveals the cream page behind (so it is always
 * seam-free — no overlaid cream shapes, no blobs). The junctions are computed
 * from the static tile geometry, so the notches stay correct and attached as the
 * (percentage-based) layout resizes.
 *
 * Fully decorative: `aria-hidden`, empty `alt`, no interactive elements.
 * Rendered as `absolute inset-0` behind the hero copy in `page.tsx`.
 */

type Rect = { left: number; top: number; width: number; height: number; z: number };

type CollageTile = {
  src: string;
  /** object-position for the crop. */
  position: string;
  /** placement + stacking, all percentages of the collage box. */
  rect: Rect;
};

const INNER_RADIUS = "var(--inner-radius)";

// Desktop cluster (landscape band). Center is dense/overlapping; edges thin out.
const DESKTOP_TILES: CollageTile[] = [
  { src: "/hero/walnut-cabinet.webp", position: "object-center", rect: { left: 0, top: 4, width: 20, height: 60, z: 1 } },
  { src: "/hero/outdoor-planters.webp", position: "object-center", rect: { left: 2, top: 58, width: 16, height: 36, z: 2 } },
  { src: "/hero/maple-cabinet-detail.webp", position: "object-[48%_center]", rect: { left: 16, top: 28, width: 16, height: 46, z: 3 } },
  { src: "/hero/pencil-box-process.webp", position: "object-[62%_center]", rect: { left: 19, top: 66, width: 22, height: 28, z: 4 } },
  { src: "/hero/dj-console-lifestyle.webp", position: "object-[50%_55%]", rect: { left: 30, top: 6, width: 13, height: 70, z: 7 } },
  { src: "/hero/geometric-cutting-board.webp", position: "object-center", rect: { left: 41, top: 2, width: 20, height: 42, z: 2 } },
  { src: "/hero/drawer-detail.webp", position: "object-[52%_72%]", rect: { left: 42, top: 42, width: 17, height: 37, z: 4 } },
  { src: "/hero/walnut-grain.webp", position: "object-center", rect: { left: 37, top: 62, width: 18, height: 32, z: 5 } },
  { src: "/hero/shelf-detail.webp", position: "object-center", rect: { left: 60, top: 2, width: 18, height: 40, z: 3 } },
  { src: "/hero/purpleheart-tray.webp", position: "object-center", rect: { left: 58, top: 38, width: 15, height: 44, z: 8 } },
  { src: "/hero/studio-desk.webp", position: "object-center", rect: { left: 55, top: 70, width: 16, height: 26, z: 6 } },
  { src: "/hero/maple-desk.webp", position: "object-[50%_62%]", rect: { left: 76, top: 3, width: 17, height: 44, z: 2 } },
  { src: "/hero/seated-desk.webp", position: "object-[50%_64%]", rect: { left: 71, top: 46, width: 16, height: 46, z: 6 } },
  { src: "/hero/dj-console.webp", position: "object-[50%_56%]", rect: { left: 86, top: 44, width: 14, height: 46, z: 4 } },
];

// Mobile cluster (portrait band). Fewer tiles; clearer pieces biased right.
const MOBILE_TILES: CollageTile[] = [
  { src: "/hero/walnut-cabinet.webp", position: "object-center", rect: { left: 2, top: 2, width: 50, height: 26, z: 1 } },
  { src: "/hero/maple-cabinet-detail.webp", position: "object-[48%_center]", rect: { left: 54, top: 2, width: 44, height: 30, z: 2 } },
  { src: "/hero/drawer-detail.webp", position: "object-[52%_72%]", rect: { left: 2, top: 30, width: 46, height: 34, z: 2 } },
  { src: "/hero/geometric-cutting-board.webp", position: "object-center", rect: { left: 54, top: 34, width: 44, height: 24, z: 2 } },
  { src: "/hero/dj-console-lifestyle.webp", position: "object-[50%_55%]", rect: { left: 38, top: 28, width: 40, height: 28, z: 5 } },
  { src: "/hero/outdoor-planters.webp", position: "object-center", rect: { left: 54, top: 60, width: 44, height: 30, z: 2 } },
  { src: "/hero/shelf-detail.webp", position: "object-center", rect: { left: 4, top: 66, width: 48, height: 28, z: 2 } },
];

const EPS = 0.001;

/**
 * Compute concave-notch disc centers (in this tile's local %) for every point
 * where a higher tile's edge crosses this tile's edge. A crossing produces a
 * "mixed" overlap corner: one coordinate comes from the higher card's edge, the
 * other from this photo's edge — exactly the sharp inside corner to round.
 */
function computeNotchMask(tile: CollageTile, index: number, tiles: CollageTile[]): CSSProperties | undefined {
  const P = tile.rect;
  const pRight = P.left + P.width;
  const pBottom = P.top + P.height;
  const discs: Array<{ x: number; y: number }> = [];

  tiles.forEach((other, otherIndex) => {
    if (otherIndex === index) return;
    const C = other.rect;
    // "above" = higher z, or same z and later in paint order
    const isAbove = C.z > P.z || (C.z === P.z && otherIndex > index);
    if (!isAbove) return;

    const cRight = C.left + C.width;
    const cBottom = C.top + C.height;
    const ol = Math.max(P.left, C.left);
    const or = Math.min(pRight, cRight);
    const ot = Math.max(P.top, C.top);
    const ob = Math.min(pBottom, cBottom);
    if (ol >= or - EPS || ot >= ob - EPS) return; // no real overlap

    // For each overlap edge, does it come from this photo (P) or the card (C)?
    const leftFromC = C.left > P.left + EPS;
    const rightFromC = cRight < pRight - EPS;
    const topFromC = C.top > P.top + EPS;
    const bottomFromC = cBottom < pBottom - EPS;

    const corners: Array<{ x: number; y: number; xFromC: boolean; yFromC: boolean }> = [
      { x: ol, y: ot, xFromC: leftFromC, yFromC: topFromC },
      { x: or, y: ot, xFromC: rightFromC, yFromC: topFromC },
      { x: ol, y: ob, xFromC: leftFromC, yFromC: bottomFromC },
      { x: or, y: ob, xFromC: rightFromC, yFromC: bottomFromC },
    ];
    for (const c of corners) {
      // Mixed corner = one edge from the card, the other from this photo =
      // a crossing (T-junction) = sharp concave corner on this photo.
      if (c.xFromC !== c.yFromC) {
        discs.push({
          x: ((c.x - P.left) / P.width) * 100,
          y: ((c.y - P.top) / P.height) * 100,
        });
      }
    }
  });

  if (discs.length === 0) return undefined;

  // Each gradient is transparent inside its disc, black outside. Composited with
  // `intersect`, the photo is kept only OUTSIDE every disc — carving the union of
  // notches. (WebKit spells intersect as `source-in`.) The carve radius bleeds
  // ~0.75px past `--inner-radius` into the cream gutter so no antialiased photo
  // sliver survives at the arc; because the revealed area is the same cream as
  // the gutter, the visible gutter width is unchanged.
  const carve = `calc(${INNER_RADIUS} + var(--notch-bleed))`;
  const gradients = discs
    .map(
      (d) =>
        `radial-gradient(${carve} at ${d.x.toFixed(2)}% ${d.y.toFixed(2)}%, #0000 0 calc(${carve} - 0.75px), #000 ${carve})`,
    )
    .join(",");

  return {
    maskImage: gradients,
    maskComposite: "intersect",
    WebkitMaskImage: gradients,
    WebkitMaskComposite: "source-in",
  } as CSSProperties;
}

function TileLayer({ tiles, className, sizes }: { tiles: CollageTile[]; className: string; sizes: string }) {
  return (
    <div className={className}>
      {tiles.map((tile, index) => {
        const mask = computeNotchMask(tile, index, tiles);
        return (
          <div
            key={`hero-tile-${index}`}
            style={{
              left: `${tile.rect.left}%`,
              top: `${tile.rect.top}%`,
              width: `${tile.rect.width}%`,
              height: `${tile.rect.height}%`,
              zIndex: tile.rect.z,
              ...mask,
            }}
            className="absolute overflow-hidden rounded-xl border-[6px] border-[#F7F5F0] bg-[#EFEAE0] shadow-[0_10px_26px_rgba(44,31,26,0.12)]"
          >
            <Image
              src={tile.src}
              alt=""
              fill
              sizes={sizes}
              loading={index < 4 ? "eager" : "lazy"}
              fetchPriority={index < 3 ? "high" : "auto"}
              className={`object-cover ${tile.position}`}
            />
          </div>
        );
      })}
    </div>
  );
}

export default function HeroMosaic() {
  return (
    <div
      className="absolute inset-0 overflow-hidden"
      aria-hidden="true"
      style={{ "--inner-radius": "16px", "--notch-bleed": "0.75px", "--collage-gap": "6px", "--outer-radius": "12px" } as CSSProperties}
    >
      <div className="absolute inset-x-3 top-3 bottom-2 sm:inset-x-5 sm:top-4 sm:bottom-3 lg:inset-x-8">
        <div className="relative mx-auto h-full max-w-[1540px]">
          <TileLayer tiles={MOBILE_TILES} className="absolute inset-0 lg:hidden" sizes="(max-width: 1023px) 48vw, 22vw" />
          <TileLayer tiles={DESKTOP_TILES} className="absolute inset-0 hidden lg:block" sizes="22vw" />
        </div>
      </div>

      {/* Left wash — fades to fully transparent, never into header/stats */}
      <div className="absolute inset-y-0 left-0 z-20 w-[80%] bg-[linear-gradient(90deg,#F7F5F0_0%,rgba(247,245,240,0.88)_26%,rgba(247,245,240,0.5)_54%,rgba(247,245,240,0.18)_78%,rgba(247,245,240,0)_100%)] sm:w-[68%] lg:w-[56%]" />
    </div>
  );
}
