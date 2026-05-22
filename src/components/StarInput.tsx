// src/components/StarInput.tsx
"use client";

import * as React from "react";

export default function StarInput({
  valueX2,
  onChange,
}: {
  valueX2: number; // 2..10
  onChange: (nextX2: number) => void;
}) {
  const pct = (valueX2 / 10) * 100; // 0..100
  const selectId = React.useId();

  // Click in halves across 5 stars
  const onClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
    const x = Math.min(rect.width, Math.max(0, e.clientX - rect.left));
    const ratio = x / rect.width; // 0..1
    const valX2 = Math.round(ratio * 10); // 0..10
    onChange(Math.min(10, Math.max(2, valX2 || 2)));
  };

  const labels = ["1", "1.5", "2", "2.5", "3", "3.5", "4", "4.5", "5"];
  const setByStep = (delta: number) => {
    onChange(Math.min(10, Math.max(2, valueX2 + delta)));
  };
  return (
    <div className="inline-flex items-center gap-2">
      <div
        className="relative cursor-pointer select-none leading-none"
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "ArrowRight" || event.key === "ArrowUp") {
            event.preventDefault();
            setByStep(1);
          } else if (event.key === "ArrowLeft" || event.key === "ArrowDown") {
            event.preventDefault();
            setByStep(-1);
          } else if (event.key === "Home") {
            event.preventDefault();
            onChange(2);
          } else if (event.key === "End") {
            event.preventDefault();
            onChange(10);
          }
        }}
        role="slider"
        tabIndex={0}
        aria-valuemin={2}
        aria-valuemax={10}
        aria-valuenow={valueX2}
        aria-valuetext={`${(valueX2 / 2).toFixed(1)} out of 5 stars`}
        aria-label="Rating"
        title={`${(valueX2 / 2).toFixed(1)} stars`}
        style={{ width: 120 }}
      >
        <div className="text-neutral-300" aria-hidden="true">★★★★★</div>
        <div className="absolute inset-0 overflow-hidden" style={{ width: `${pct}%` }} aria-hidden="true">
          <div className="text-amber-500">★★★★★</div>
        </div>
      </div>
      <span className="text-sm text-neutral-700">{(valueX2 / 2).toFixed(1)}</span>
      {/* fallback select for accessibility */}
      <label htmlFor={selectId} className="sr-only">Rating</label>
      <select
        id={selectId}
        className="rounded border px-2 py-1 text-sm"
        value={valueX2}
        onChange={(e) => onChange(parseInt(e.target.value, 10))}
      >
        {[...Array(9)].map((_, i) => {
          const x2 = 2 + i; // 2..10
          return (
            <option key={x2} value={x2}>
              {labels[i]} ★
            </option>
          );
        })}
      </select>
    </div>
  );
}
