"use client";

import { useState } from "react";

// Shows a count that rises into place whenever it changes. The first render
// never animates, so counts don't move on page load.
export default function RollingNumber({
  value,
  className = "",
}: {
  value: number;
  className?: string;
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
      {value.toLocaleString("en-US")}
    </span>
  );
}
