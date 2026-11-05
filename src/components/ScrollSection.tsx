// src/components/ScrollSection.tsx
"use client";
import { useState, type ReactNode } from "react";
import { useInView } from "@/hooks/useInView";

export function ScrollSection({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  const { ref, hasObserved, inView } = useInView({ threshold: 0.08 });
  const shouldReveal = !hasObserved || inView;
  // Cards only play their entrance when a hidden section scrolls into view. A
  // section already on screen, including after Back, stays exactly as it is.
  const [wasHidden, setWasHidden] = useState(false);
  if (hasObserved && !inView && !wasHidden) setWasHidden(true);

  return (
    <div
      ref={ref}
      data-revealed={shouldReveal ? (wasHidden ? "true" : "settled") : "false"}
      className={`motion-safe:transition-[opacity,transform,translate] motion-safe:duration-700 motion-safe:ease-out ${
        shouldReveal ? "opacity-100 translate-y-0" : "motion-safe:opacity-0 motion-safe:translate-y-6"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
