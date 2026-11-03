"use client";

import RollingText from "@/components/RollingText";

// A count that rolls to its new value (see RollingText): browse results,
// follower and helpful counts. The first render never animates.
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
  return (
    <RollingText
      value={value}
      text={grouped ? value.toLocaleString("en-US") : String(value)}
      className={className}
    />
  );
}
