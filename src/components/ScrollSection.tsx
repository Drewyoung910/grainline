// src/components/ScrollSection.tsx
"use client";
import { useInView } from "@/hooks/useInView";

export function ScrollSection({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  const { ref, inView } = useInView({ threshold: 0.08 });
  return (
    <div
      ref={ref}
      className={`transition-[opacity,transform] duration-700 ease-out ${
        inView ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6"
      } ${className ?? ""}`}
    >
      {children}
    </div>
  );
}
