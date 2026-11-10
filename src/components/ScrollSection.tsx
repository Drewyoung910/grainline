// src/components/ScrollSection.tsx
"use client";
import { useEffect, useState, type ReactNode } from "react";
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
  const [wasHidden, setWasHidden] = useState(false);
  useEffect(() => {
    if (hasObserved && !inView) setWasHidden(true);
  }, [hasObserved, inView]);

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
