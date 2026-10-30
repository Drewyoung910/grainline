"use client";

import * as React from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Check, ChevronDown } from "@/components/icons";

const SORT_OPTIONS = [
  { value: "relevant", label: "Most relevant", needsQuery: true },
  { value: "newest", label: "Newest", needsQuery: false },
  { value: "price_asc", label: "Price: low to high", needsQuery: false },
  { value: "price_desc", label: "Price: high to low", needsQuery: false },
  { value: "popular", label: "Most popular", needsQuery: false },
];

// Desktop browse sort: a pill that springs open a small card of orders, the
// chosen one ticked. Phones keep the sort sheet in MobileFilterBar.
export default function SortMenu() {
  const searchParams = useSearchParams();
  const q = searchParams.get("q") ?? "";
  const currentSort = searchParams.get("sort") ?? (q ? "relevant" : "newest");
  const options = SORT_OPTIONS.filter((option) => !option.needsQuery || q);
  const currentLabel = options.find((option) => option.value === currentSort)?.label ?? "Newest";

  const [open, setOpen] = React.useState(false);
  const [closing, setClosing] = React.useState(false);
  const containerRef = React.useRef<HTMLDivElement>(null);
  const buttonRef = React.useRef<HTMLButtonElement>(null);
  const closeTimerRef = React.useRef<number | null>(null);
  const menuId = React.useId();

  const close = React.useCallback((returnFocus = false) => {
    if (closeTimerRef.current !== null) return;
    setClosing(true);
    closeTimerRef.current = window.setTimeout(() => {
      closeTimerRef.current = null;
      setClosing(false);
      setOpen(false);
      if (returnFocus) buttonRef.current?.focus();
    }, 160);
  }, []);

  React.useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current);
  }, []);

  React.useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) close();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  const hrefFor = (value: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("sort", value);
    params.delete("page");
    return `/browse?${params.toString()}`;
  };

  return (
    <div
      ref={containerRef}
      className="relative hidden md:block"
      onBlur={(event) => {
        if (open && !event.currentTarget.contains(event.relatedTarget as Node | null)) close();
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => (open ? close() : setOpen(true))}
        className="btn btn-sm btn-secondary gap-1.5"
      >
        <span className="text-neutral-500">Sort:</span> {currentLabel}
        <ChevronDown size={16} className={`transition-transform duration-300 ${open && !closing ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div
          id={menuId}
          role="dialog"
          aria-label="Sort results"
          className={`absolute right-0 top-[calc(100%+8px)] z-30 w-56 origin-top-right rounded-2xl bg-white p-1.5 popover-shadow motion-reduce:animate-none ${
            closing ? "animate-menu-out pointer-events-none" : "animate-menu-in"
          }`}
        >
          {options.map((option) => {
            const selected = option.value === currentSort;
            return (
              <Link
                key={option.value}
                href={hrefFor(option.value)}
                scroll={false}
                aria-current={selected ? "true" : undefined}
                onClick={() => {
                  close();
                  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
                  window.scrollTo({ top: 0, behavior: reduceMotion ? "auto" : "smooth" });
                }}
                className={`flex items-center justify-between rounded-[10px] px-3 py-2.5 text-[14.5px] hover:bg-[#F7F5F0] ${
                  selected ? "font-medium text-neutral-900" : "text-neutral-700"
                }`}
              >
                {option.label}
                <Check
                  size={16}
                  className={`text-[#2C1F1A] transition-[opacity,scale] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
                    selected ? "scale-100 opacity-100" : "scale-50 opacity-0"
                  }`}
                />
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
