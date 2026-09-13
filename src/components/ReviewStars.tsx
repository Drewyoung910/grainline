// src/components/ReviewStars.tsx
"use client";

import * as React from "react";

type Props = {
  valueX2: number;                // 0..10 (we'll clamp to 2..10 on submit)
  onChangeX2?: (n: number) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  readOnly?: boolean;
  "aria-label"?: string;
};

export default function ReviewStars({
  valueX2,
  onChangeX2,
  disabled,
  size = "md",
  readOnly = false,
  ...rest
}: Props) {
  const [hoverX2, setHoverX2] = React.useState<number | null>(null);
  const activeX2 = hoverX2 ?? valueX2 ?? 0;
  const percent = Math.max(0, Math.min(100, (activeX2 / 10) * 100));

  const starCls =
    size === "sm" ? "text-[14px] leading-none" : "text-[18px] leading-none";

  return (
    <div className="relative inline-block" {...rest}>
      {/* visual layer */}
      <div className={`relative select-none ${starCls}`} aria-hidden>
        <div className="text-neutral-300">★★★★★</div>
        <div
          className="absolute inset-0 overflow-hidden"
          style={{ width: `${percent}%` }}
        >
          <div className="text-amber-500">★★★★★</div>
        </div>
      </div>

      {/* interactive hit-grid (10 halves) */}
      {!readOnly && onChangeX2 && (
        <div
          className="absolute inset-0 grid grid-cols-10"
          onMouseLeave={() => setHoverX2(null)}
          role="radiogroup"
          aria-label={rest["aria-label"] ?? "Rating"}
        >
          {Array.from({ length: 10 }).map((_, i) => {
            const val = i + 1; // 1..10 (we only submit 2..10)
            return (
              <button
                key={i}
                type="button"
                className="cursor-pointer"
                onMouseEnter={() => setHoverX2(val)}
                onFocus={() => setHoverX2(val)}
                onClick={() => !disabled && onChangeX2(val)}
                disabled={disabled}
                role="radio"
                aria-checked={valueX2 === val}
                aria-label={`${(val / 2).toFixed(1)} stars`}
              />
            );
          })}
        </div>
      )}
    </div>
  );
}
