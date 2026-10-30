"use client";

import { useState } from "react";

// The motion study's number roll: when the value changes, the old text slides
// out as the new text slides in, upward when the number grows and downward
// when it shrinks. The first render never animates. Roll state moves in the
// same render as the value (React's "adjust state while rendering" pattern),
// so the new text never flashes before it rolls; Object.is keeps a NaN from
// re-rendering forever. Under reduced motion the outgoing copy stays hidden.
export default function RollingText({
  value,
  text,
  className = "",
}: {
  value: number;
  text: string;
  className?: string;
}) {
  const [roll, setRoll] = useState({ value, text, previousText: "", direction: "up" as "up" | "down", count: 0 });
  if (!Object.is(roll.value, value)) {
    setRoll({
      value,
      text,
      previousText: roll.text,
      direction: value < roll.value ? "down" : "up",
      count: roll.count + 1,
    });
  } else if (roll.text !== text) {
    // Same number, new formatting (e.g. currency): swap without a roll.
    setRoll({ ...roll, text });
  }

  return (
    // The outgoing copy is out of flow, so a shorter new value never keeps
    // the old width.
    <span className={`relative inline-block tabular-nums${className ? ` ${className}` : ""}`}>
      {roll.count > 0 && (
        <span
          key={`out-${roll.count}`}
          aria-hidden="true"
          data-dir={roll.direction}
          className="count-roll-out pointer-events-none absolute left-0 top-0 select-none whitespace-nowrap"
        >
          {roll.previousText}
        </span>
      )}
      <span
        key={`in-${roll.count}`}
        data-dir={roll.direction}
        className={`inline-block${roll.count > 0 ? " count-roll-in" : ""}`}
      >
        {text}
      </span>
    </span>
  );
}
