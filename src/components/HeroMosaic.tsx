import Image from "next/image";
import type { CSSProperties } from "react";

/**
 * Decorative homepage hero collage — an overlapping matted-photo layout.
 *
 * Why not a grid: a CSS grid forces tiles onto shared row/column axes (reads as
 * a grid, not a collage) and, when tiles overlap, carves L-shaped negative space
 * with sharp concave corners. Instead, every photo here is an independently
 * positioned rounded rectangle with its own cream mat (`border-[#F7F5F0]`) and a
 * soft shadow, stacked with z-index like a pile of prints on a table. Because
 * each tile is a self-contained rounded rect painted on top, every visible edge
 * is a convex rounded corner — there are NO concave corners to "fix", overlaps
 * read as intentional layering, and free x/y placement breaks the grid axes for
 * a random feel. The mat width is constant, so the gap reads consistent whether
 * two tiles touch or overlap. Tiles cluster densely in the middle and thin out
 * toward the edges.
 *
 * Fully decorative: `aria-hidden`, empty `alt`, no interactive elements. The
 * nearby hero heading/CTAs carry the semantics. Rendered as `absolute inset-0`
 * behind the hero copy in `page.tsx`.
 *
 * Retune by editing the two arrays (desktop / mobile). Vertical extents stay
 * under ~95% so the bottom row keeps its rounded corners instead of being clipped
 * flat by the section's overflow.
 */

type CollageTile = {
  src: string;
  /** object-position for the crop. */
  position: string;
  /** left / top / width / height (%) + zIndex — free placement, may overlap. */
  style: CSSProperties;
};

// Desktop cluster (landscape band). Center is dense/overlapping; edges thin out.
// Larger, texture-y pieces sit left (under the wash); clearer pieces sit center
// and right where they stay bright.
const DESKTOP_TILES: CollageTile[] = [
  { src: "/hero/walnut-cabinet.webp", position: "object-center", style: { left: "0%", top: "4%", width: "20%", height: "60%", zIndex: 1 } },
  { src: "/hero/outdoor-planters.webp", position: "object-center", style: { left: "2%", top: "58%", width: "16%", height: "36%", zIndex: 2 } },
  { src: "/hero/maple-cabinet-detail.webp", position: "object-[48%_center]", style: { left: "16%", top: "28%", width: "16%", height: "46%", zIndex: 3 } },
  { src: "/hero/pencil-box-process.webp", position: "object-[62%_center]", style: { left: "19%", top: "66%", width: "22%", height: "28%", zIndex: 4 } },
  { src: "/hero/dj-console-lifestyle.webp", position: "object-[50%_55%]", style: { left: "30%", top: "6%", width: "13%", height: "70%", zIndex: 7 } },
  { src: "/hero/geometric-cutting-board.webp", position: "object-center", style: { left: "41%", top: "2%", width: "20%", height: "42%", zIndex: 2 } },
  { src: "/hero/drawer-detail.webp", position: "object-[52%_72%]", style: { left: "42%", top: "42%", width: "17%", height: "37%", zIndex: 4 } },
  { src: "/hero/walnut-grain.webp", position: "object-center", style: { left: "37%", top: "62%", width: "18%", height: "32%", zIndex: 5 } },
  { src: "/hero/shelf-detail.webp", position: "object-center", style: { left: "60%", top: "2%", width: "18%", height: "40%", zIndex: 3 } },
  { src: "/hero/purpleheart-tray.webp", position: "object-center", style: { left: "58%", top: "38%", width: "15%", height: "44%", zIndex: 8 } },
  { src: "/hero/studio-desk.webp", position: "object-center", style: { left: "55%", top: "70%", width: "16%", height: "26%", zIndex: 6 } },
  { src: "/hero/maple-desk.webp", position: "object-[50%_62%]", style: { left: "76%", top: "3%", width: "17%", height: "44%", zIndex: 2 } },
  { src: "/hero/seated-desk.webp", position: "object-[50%_64%]", style: { left: "71%", top: "46%", width: "16%", height: "46%", zIndex: 6 } },
  { src: "/hero/dj-console.webp", position: "object-[50%_56%]", style: { left: "86%", top: "44%", width: "14%", height: "46%", zIndex: 4 } },
];

// Mobile cluster (portrait band). Fewer tiles; clearer pieces biased right where
// the wash is thinnest.
const MOBILE_TILES: CollageTile[] = [
  { src: "/hero/walnut-cabinet.webp", position: "object-center", style: { left: "2%", top: "2%", width: "50%", height: "26%", zIndex: 1 } },
  { src: "/hero/maple-cabinet-detail.webp", position: "object-[48%_center]", style: { left: "54%", top: "2%", width: "44%", height: "30%", zIndex: 2 } },
  { src: "/hero/drawer-detail.webp", position: "object-[52%_72%]", style: { left: "2%", top: "30%", width: "46%", height: "34%", zIndex: 2 } },
  { src: "/hero/geometric-cutting-board.webp", position: "object-center", style: { left: "54%", top: "34%", width: "44%", height: "24%", zIndex: 2 } },
  { src: "/hero/dj-console-lifestyle.webp", position: "object-[50%_55%]", style: { left: "38%", top: "28%", width: "40%", height: "28%", zIndex: 5 } },
  { src: "/hero/outdoor-planters.webp", position: "object-center", style: { left: "54%", top: "60%", width: "44%", height: "30%", zIndex: 2 } },
  { src: "/hero/shelf-detail.webp", position: "object-center", style: { left: "4%", top: "66%", width: "48%", height: "28%", zIndex: 2 } },
];

function TileLayer({ tiles, className, sizes }: { tiles: CollageTile[]; className: string; sizes: string }) {
  return (
    <div className={className}>
      {tiles.map((tile, index) => (
        <div
          key={`hero-tile-${index}`}
          style={tile.style}
          className="absolute overflow-hidden rounded-xl border-[6px] border-[#F7F5F0] bg-[#EFEAE0] shadow-[0_10px_26px_rgba(44,31,26,0.15)]"
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
      ))}
    </div>
  );
}

export default function HeroMosaic() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
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
