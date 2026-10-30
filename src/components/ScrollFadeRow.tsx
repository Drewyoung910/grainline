"use client";
import { useRef, useCallback, useEffect, useState } from "react";
import { ChevronLeft, ChevronRight } from "@/components/icons";

type Props = {
  children: React.ReactNode;
  className?: string;
  /** Disable fade edges above this breakpoint. Use this on surfaces that
   * switch from horizontal scroll to a static grid at the matching
   * breakpoint so the fade doesn't mis-signal a static grid as scrollable.
   * `"sm"` disables fade at >= 640px (default seller-profile pattern).
   * `"lg"` disables at >= 1024px (Featured Work asymmetric grid).
   * Omit for fade-always (homepage scroll rows). */
  mobileOnly?: boolean;
  hideAtBreakpoint?: "sm" | "lg";
  /** Show previous/next buttons on hover that glide the row by about one
   * screen of cards. Mouse and trackpad only; touch rows just swipe. */
  arrows?: boolean;
};

export default function ScrollFadeRow({
  children,
  className = "",
  mobileOnly = false,
  hideAtBreakpoint,
  arrows = false,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [canScrollBack, setCanScrollBack] = useState(false);
  const [canScrollForward, setCanScrollForward] = useState(false);

  const updateEdgeState = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // Left fade: only when scrolled away from the start.
    if (el.scrollLeft > 0) {
      el.setAttribute("data-scrolled", "true");
    } else {
      el.removeAttribute("data-scrolled");
    }
    // Right fade: hide when at end. 2px tolerance handles subpixel
    // rounding from device pixel ratios and zoom.
    const atEnd = el.scrollLeft + el.clientWidth >= el.scrollWidth - 2;
    if (atEnd) {
      el.setAttribute("data-end", "true");
    } else {
      el.removeAttribute("data-end");
    }
    if (arrows) {
      setCanScrollBack(el.scrollLeft > 8);
      setCanScrollForward(el.scrollLeft + el.clientWidth < el.scrollWidth - 8);
    }
  }, [arrows]);

  // Recheck end state when children change size (e.g. after async load
  // populates the row) — without this the row stays in "scrollable" mode
  // even if all children now fit.
  useEffect(() => {
    updateEdgeState();
    const el = ref.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(() => updateEdgeState());
    ro.observe(el);
    for (const child of Array.from(el.children)) {
      ro.observe(child);
    }
    return () => ro.disconnect();
  }, [updateEdgeState]);

  const scrollByPage = useCallback((direction: -1 | 1) => {
    const el = ref.current;
    if (!el) return;
    const reduceMotion =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({
      left: direction * Math.max(el.clientWidth * 0.9, 200),
      behavior: reduceMotion ? "auto" : "smooth",
    });
  }, []);

  // Back-compat: mobileOnly === "sm" hide breakpoint.
  const breakpoint = hideAtBreakpoint ?? (mobileOnly ? "sm" : undefined);
  const fadeClass = breakpoint === "sm"
    ? "scroll-fade-edges-sm"
    : breakpoint === "lg"
    ? "scroll-fade-edges-lg"
    : "scroll-fade-edges";

  const row = (
    <div
      ref={ref}
      onScroll={updateEdgeState}
      className={`${fadeClass} ${className}`}
    >
      {children}
    </div>
  );

  if (!arrows) return row;

  const arrowClass =
    "absolute top-[calc(50%-2.75rem)] z-10 hidden h-11 w-11 place-items-center rounded-full bg-white text-neutral-900 shadow-[0_10px_30px_-14px_rgba(0,0,0,0.5)] ring-1 ring-black/5 opacity-0 scale-[0.85] transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] [@media(hover:hover)]:grid group-hover/row:opacity-100 group-hover/row:scale-100 focus-visible:opacity-100 focus-visible:scale-100 disabled:pointer-events-none disabled:!opacity-0";

  return (
    <div className="group/row relative">
      {row}
      <button
        type="button"
        aria-label="Scroll back"
        // Pointer-only affordance: keyboard and screen-reader users move
        // through the cards themselves, and a focused arrow would lose focus
        // when it hides at the end of the row.
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => scrollByPage(-1)}
        disabled={!canScrollBack}
        className={`${arrowClass} -left-3`}
      >
        <ChevronLeft size={20} />
      </button>
      <button
        type="button"
        aria-label="Scroll forward"
        // Pointer-only affordance: keyboard and screen-reader users move
        // through the cards themselves, and a focused arrow would lose focus
        // when it hides at the end of the row.
        tabIndex={-1}
        aria-hidden="true"
        onClick={() => scrollByPage(1)}
        disabled={!canScrollForward}
        className={`${arrowClass} -right-3`}
      >
        <ChevronRight size={20} />
      </button>
    </div>
  );
}
