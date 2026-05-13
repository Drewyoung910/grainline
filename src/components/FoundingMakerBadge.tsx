"use client";

import { useId, useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";

type Props = {
  /** When > 0, shown as "#N" alongside the badge. Null/0 hides the number. */
  number?: number | null;
  showLabel?: boolean;
  size?: number;
};

// Compact wax-seal style badge — amber gradient ring with a star center.
// Sized to match the GuildBadge so it can sit next to it without visual clash.
export default function FoundingMakerBadge({ number, showLabel = false, size = 22 }: Props) {
  const gradId = useId();
  const [open, setOpen] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number; width: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      const t = e.target as Node;
      if (
        triggerRef.current && !triggerRef.current.contains(t) &&
        popoverRef.current && !popoverRef.current.contains(t)
      ) {
        setOpen(false);
      }
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  function handleOpen() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (r) {
      const popWidth = 280;
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;
      let left = r.left + scrollX + r.width / 2 - popWidth / 2;
      const minLeft = 8;
      const maxLeft = window.innerWidth + scrollX - popWidth - 8;
      if (left < minLeft) left = minLeft;
      if (left > maxLeft) left = maxLeft;
      setCoords({ top: r.bottom + scrollY + 8, left, width: popWidth });
    }
    setOpen(true);
  }

  return (
    <span className="relative inline-flex items-center gap-1.5">
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          if (open) {
            setOpen(false);
          } else {
            handleOpen();
          }
        }}
        className="inline-flex items-center gap-1 focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-300 rounded-full"
        aria-label={number ? `Founding Maker #${number}` : "Founding Maker"}
      >
        <svg
          width={size}
          height={size}
          viewBox="0 0 100 100"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
          className="drop-shadow-sm"
        >
          <defs>
            <radialGradient id={`fm-grad-${gradId}`} cx="50%" cy="35%" r="65%">
              <stop offset="0%" stopColor="#FFE9A8" />
              <stop offset="55%" stopColor="#D29A3A" />
              <stop offset="100%" stopColor="#8B5E1F" />
            </radialGradient>
          </defs>
          {/* Outer wax-seal disc */}
          <circle cx="50" cy="50" r="46" fill={`url(#fm-grad-${gradId})`} stroke="#6B4514" strokeWidth="2" />
          {/* Inner ring */}
          <circle cx="50" cy="50" r="36" fill="none" stroke="#6B4514" strokeWidth="1.5" opacity="0.7" />
          {/* Star center */}
          <polygon
            points="50,22 58,42 80,42 62,55 69,76 50,63 31,76 38,55 20,42 42,42"
            fill="#FFF6DC"
            stroke="#6B4514"
            strokeWidth="1.4"
            strokeLinejoin="round"
          />
        </svg>
        {showLabel && (
          <span className="text-xs font-semibold tracking-wide" style={{ color: "#8B5E1F" }}>
            Founding Maker{number ? ` · #${number}` : ""}
          </span>
        )}
      </button>

      {open && mounted && coords && createPortal(
        <div
          ref={popoverRef}
          role="dialog"
          aria-label="Founding Maker"
          className="z-[1000] rounded-xl bg-white shadow-xl ring-1 ring-stone-200 p-4 text-left"
          style={{
            position: "absolute",
            top: coords.top,
            left: coords.left,
            width: coords.width,
          }}
        >
          <div className="flex items-start gap-3">
            <svg width={40} height={40} viewBox="0 0 100 100" aria-hidden="true" className="flex-none">
              <defs>
                <radialGradient id={`fm-pop-${gradId}`} cx="50%" cy="35%" r="65%">
                  <stop offset="0%" stopColor="#FFE9A8" />
                  <stop offset="55%" stopColor="#D29A3A" />
                  <stop offset="100%" stopColor="#8B5E1F" />
                </radialGradient>
              </defs>
              <circle cx="50" cy="50" r="46" fill={`url(#fm-pop-${gradId})`} stroke="#6B4514" strokeWidth="2" />
              <circle cx="50" cy="50" r="36" fill="none" stroke="#6B4514" strokeWidth="1.5" opacity="0.7" />
              <polygon
                points="50,22 58,42 80,42 62,55 69,76 50,63 31,76 38,55 20,42 42,42"
                fill="#FFF6DC"
                stroke="#6B4514"
                strokeWidth="1.4"
                strokeLinejoin="round"
              />
            </svg>
            <div className="flex-1 min-w-0">
              <p className="font-semibold text-neutral-900">
                Founding Maker{number ? ` · #${number}` : ""}
              </p>
              <p className="text-xs text-neutral-600 mt-1 leading-relaxed">
                One of the first 250 makers on Grainline. This badge is permanent and was awarded in recognition of
                early support for the platform.
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}
