"use client";

import { useState } from "react";

export default function CharCounter({
  name,
  maxLength,
  defaultValue,
  rows = 4,
  placeholder,
  className,
}: {
  name: string;
  maxLength: number;
  defaultValue?: string;
  rows?: number;
  placeholder?: string;
  className?: string;
}) {
  const [count, setCount] = useState((defaultValue ?? "").length);

  return (
    <div>
      <textarea
        name={name}
        rows={rows}
        maxLength={maxLength}
        defaultValue={defaultValue}
        placeholder={placeholder}
        onChange={(e) => setCount(e.target.value.length)}
        className={className ?? "w-full border rounded px-3 py-2"}
      />
      <p className="text-xs text-neutral-400 text-right mt-0.5">
        {count} / {maxLength}
      </p>
    </div>
  );
}
