"use client";
import { useRef, useCallback } from "react";

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

  const handleScroll = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    if (el.scrollLeft > 0) {
      el.setAttribute("data-scrolled", "true");
    } else {
      el.removeAttribute("data-scrolled");
    }
  }, []);

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
      onScroll={handleScroll}
      className={`${fadeClass} ${className}`}
    >
      {children}
    </div>
  );
}
