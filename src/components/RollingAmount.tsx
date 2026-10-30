"use client";

import { useState } from "react";
import { formatCurrencyCents } from "@/lib/money";

// A money amount that rolls into place when it changes (cart line totals and
// subtotals). The first render never animates. The roll key moves in the same
// render as the amount (React's "adjust state while rendering" pattern), so
// the new amount never shows for a frame before it rolls in; Object.is keeps
// an unexpected NaN from re-rendering forever.
export default function RollingAmount({
  cents,
  currency,
  className = "",
}: {
  cents: number;
  currency: string | null | undefined;
  className?: string;
}) {
  const [shownCents, setShownCents] = useState(cents);
  const [changeCount, setChangeCount] = useState(0);
  if (!Object.is(shownCents, cents)) {
    setShownCents(cents);
    setChangeCount((count) => count + 1);
  }

  return (
    <span
      key={changeCount}
      className={`inline-block tabular-nums${changeCount > 0 ? " count-roll-in" : ""}${className ? ` ${className}` : ""}`}
    >
      {formatCurrencyCents(cents, currency)}
    </span>
  );
}
