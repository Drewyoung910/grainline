"use client";

import * as React from "react";
import Link from "next/link";

export type SegmentOption = {
  value: string;
  label: React.ReactNode;
  // Link mode: the option navigates (a URL-backed filter or view). Without
  // it the option is a radio button that calls onChange.
  href?: string;
  ariaLabel?: string;
};

// The motion study's sliding toggle: a cream track with a white thumb that
// springs to the chosen option. Radio mode is a keyboard radiogroup (arrow
// keys, Home, End); link mode moves the thumb as soon as an option is clicked,
// before the next page arrives.
export default function SegmentedControl({
  options,
  value,
  onChange,
  label,
  name,
  size = "md",
  fullWidth = false,
  linkScroll,
  onLinkClick,
  className = "",
}: {
  options: SegmentOption[];
  value: string;
  onChange?: (value: string) => void;
  label: string;
  // Form use: submit the chosen value under this name.
  name?: string;
  size?: "sm" | "md";
  fullWidth?: boolean;
  linkScroll?: boolean;
  onLinkClick?: () => void;
  className?: string;
}) {
  const [pendingValue, setPendingValue] = React.useState<string | null>(null);
  const [settledValue, setSettledValue] = React.useState(value);
  if (settledValue !== value) {
    setSettledValue(value);
    setPendingValue(null);
  }
  const activeValue = pendingValue ?? value;
  const optionKey = options.map((option) => option.value).join("|");

  const trackRef = React.useRef<HTMLDivElement>(null);
  const optionRefs = React.useRef(new Map<string, HTMLElement>());
  const [thumb, setThumb] = React.useState<{ left: number; width: number; animate: boolean } | null>(null);

  React.useLayoutEffect(() => {
    const measure = () => {
      const element = optionRefs.current.get(activeValue);
      if (!element) return;
      setThumb((previous) => ({
        left: element.offsetLeft,
        width: element.offsetWidth,
        animate: previous !== null,
      }));
    };
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [activeValue, optionKey]);

  const choose = (next: string) => {
    if (next === activeValue) return;
    setPendingValue(next);
    onChange?.(next);
  };

  const onKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const keys = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const index = Math.max(0, options.findIndex((option) => option.value === activeValue));
    const last = options.length - 1;
    const nextIndex =
      event.key === "Home"
        ? 0
        : event.key === "End"
          ? last
          : event.key === "ArrowRight" || event.key === "ArrowDown"
            ? (index === last ? 0 : index + 1)
            : (index === 0 ? last : index - 1);
    const next = options[nextIndex];
    choose(next.value);
    optionRefs.current.get(next.value)?.focus();
  };

  const linkMode = options.some((option) => option.href);
  const height = size === "sm" ? "h-8" : "h-[34px]";
  const text = size === "sm" ? "text-[13px]" : "text-[13.5px]";

  return (
    <div
      ref={trackRef}
      role={linkMode ? "group" : "radiogroup"}
      aria-label={label}
      onKeyDown={linkMode ? undefined : onKeyDown}
      className={`relative ${fullWidth ? "grid w-full grid-flow-col auto-cols-fr" : "inline-grid grid-flow-col auto-cols-auto"} rounded-full bg-[#EFEAE0] p-1 ${className}`}
    >
      {thumb && (
        <span
          aria-hidden="true"
          className={`pointer-events-none absolute bottom-1 left-0 top-1 rounded-full bg-white shadow-[0_2px_8px_-3px_rgba(0,0,0,0.25)] ${
            thumb.animate
              ? "transition-[translate,width] duration-[420ms] ease-[cubic-bezier(0.34,1.56,0.64,1)] motion-reduce:transition-none"
              : ""
          }`}
          style={{ width: thumb.width, translate: `${thumb.left}px 0` }}
        />
      )}
      {options.map((option) => {
        const selected = option.value === activeValue;
        // Before the thumb is measured (first paint), the chosen option
        // carries the white fill itself so nothing flashes.
        const fallbackFill = selected && !thumb ? " bg-white shadow-[0_2px_8px_-3px_rgba(0,0,0,0.25)]" : "";
        const optionClass = `relative z-[1] inline-flex ${height} items-center justify-center whitespace-nowrap rounded-full px-3 ${text} font-medium transition-colors duration-300 focus-visible:outline-offset-[-2px] ${
          selected ? "text-neutral-900" : "text-neutral-600 hover:text-neutral-900"
        }${fallbackFill}`;
        const setRef = (element: HTMLElement | null) => {
          if (element) optionRefs.current.set(option.value, element);
          else optionRefs.current.delete(option.value);
        };
        if (option.href) {
          return (
            <Link
              key={option.value}
              ref={setRef}
              href={option.href}
              scroll={linkScroll}
              aria-label={option.ariaLabel}
              aria-current={selected ? "page" : undefined}
              onClick={(event) => {
                if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
                if (!selected) setPendingValue(option.value);
                onLinkClick?.();
              }}
              className={optionClass}
            >
              {option.label}
            </Link>
          );
        }
        return (
          <button
            key={option.value}
            ref={setRef}
            type="button"
            role="radio"
            aria-checked={selected}
            aria-label={option.ariaLabel}
            tabIndex={selected ? 0 : -1}
            onClick={() => choose(option.value)}
            className={optionClass}
          >
            {option.label}
          </button>
        );
      })}
      {name && <input type="hidden" name={name} value={activeValue} />}
    </div>
  );
}
