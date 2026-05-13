"use client";
import { useRef, useCallback, useEffect } from "react";

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
};

export default function ScrollFadeRow({
  children,
  className = "",
  mobileOnly = false,
  hideAtBreakpoint,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

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
  }, []);

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

  // Back-compat: mobileOnly === "sm" hide breakpoint.
  const breakpoint = hideAtBreakpoint ?? (mobileOnly ? "sm" : undefined);
  const fadeClass = breakpoint === "sm"
    ? "scroll-fade-edges-sm"
    : breakpoint === "lg"
    ? "scroll-fade-edges-lg"
    : "scroll-fade-edges";

  return (
    <div
      ref={ref}
      onScroll={updateEdgeState}
      className={`${fadeClass} ${className}`}
    >
      {children}
    </div>
  );
}
