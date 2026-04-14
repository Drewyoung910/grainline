"use client";
import { useRef, useCallback } from "react";

export default function ScrollFadeRow({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
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

  return (
    <div
      ref={ref}
      onScroll={handleScroll}
      className={`scroll-fade-edges ${className}`}
    >
      {children}
    </div>
  );
}
