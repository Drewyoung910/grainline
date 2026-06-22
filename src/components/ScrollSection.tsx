// src/components/ScrollSection.tsx
"use client";
import { type ReactNode } from "react";
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

  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-700 ease-out ${
        shouldReveal ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
