"use client";

import { useState } from "react";

// Shows a count that rises into place whenever it changes. The first render
// never animates, so counts don't move on page load.
export default function RollingNumber({
  value,
  className = "",
  grouped = true,
}: {
  value: number;
  className?: string;
  // Thousands separators ("1,000"). Off keeps the plain digits a caller
  // already showed before it animated.
  grouped?: boolean;
}) {
  const [shown, setShown] = useState(value);
  const [changeCount, setChangeCount] = useState(0);
  if (value !== shown) {
    setShown(value);
    setChangeCount((count) => count + 1);
  }

  return (
    <span
      key={changeCount}
      className={`inline-block${changeCount > 0 ? " count-roll-in" : ""}${className ? ` ${className}` : ""}`}
    >
      {grouped ? value.toLocaleString("en-US") : value}
    </span>
  );
}
