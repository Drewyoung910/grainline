"use client";

import { useEffect, useRef, useState } from "react";

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
  const previousValueRef = useRef(value);
  const [changeCount, setChangeCount] = useState(0);

  // Restart after a committed prop change instead of scheduling state during
  // render. Object.is also treats NaN as stable, so an unexpected bad count
  // cannot cause an infinite render loop.
  useEffect(() => {
    if (Object.is(value, previousValueRef.current)) return;
    previousValueRef.current = value;
    setChangeCount((count) => count + 1);
  }, [value]);

  return (
    <span
      key={changeCount}
      className={`inline-block${changeCount > 0 ? " count-roll-in" : ""}${className ? ` ${className}` : ""}`}
    >
      {grouped ? value.toLocaleString("en-US") : value}
    </span>
  );
}
