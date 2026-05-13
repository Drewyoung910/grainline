"use client";
import { useEffect, useRef, useState } from "react";

type Props = {
  text: string;
  /** Max number of lines to clamp to when collapsed. */
  clampLines?: number;
  className?: string;
};

/**
 * Collapsible body text with a "Read more" / "Show less" toggle.
 * The toggle only renders if the text is actually clamped — short blurbs
 * just show inline with no button.
 */
export default function ExpandableText({ text, clampLines = 3, className = "" }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);
  const ref = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    function check() {
      const el = ref.current;
      if (!el) return;
      if (expanded) {
        setOverflowing(true);
        return;
      }
      setOverflowing(el.scrollHeight > el.clientHeight + 1);
    }
    check();
    const ro = new ResizeObserver(check);
    if (ref.current) ro.observe(ref.current);
    window.addEventListener("resize", check);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", check);
    };
  }, [expanded, text]);

  const lineClampStyle = !expanded
    ? ({
        display: "-webkit-box",
        WebkitBoxOrient: "vertical",
        WebkitLineClamp: clampLines,
        overflow: "hidden",
      } as React.CSSProperties)
    : undefined;

  return (
    <div className={className}>
      <p
        ref={ref}
        style={lineClampStyle}
        className="text-sm text-neutral-700 leading-relaxed whitespace-pre-line"
      >
        {text}
      </p>
      {overflowing && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 text-xs font-medium text-amber-700 hover:underline"
        >
          {expanded ? "Show less" : "Read more"}
        </button>
      )}
    </div>
  );
}
