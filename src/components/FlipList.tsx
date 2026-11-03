"use client";

import * as React from "react";

const GLIDE_MS = 420;
const ENTER_MS = 240;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
const GLIDE_ID = "flip-glide";
// Far from the viewport nobody sees the move, so it isn't worth the work.
const VIEWPORT_MARGIN = 200;

type Point = { x: number; y: number };

// Where each card lives, relative to the list. Offsets ignore transforms, so a
// card partway through a glide can't be mistaken for one that lives there.
function readPositions(list: HTMLElement): Map<string, Point> {
  const positions = new Map<string, Point>();
  for (const item of list.querySelectorAll<HTMLElement>(":scope > [data-flip-id]")) {
    positions.set(item.dataset.flipId as string, { x: item.offsetLeft, y: item.offsetTop });
  }
  return positions;
}

// How far along a running glide has carried a card, then stops that glide. A
// change partway through continues from here instead of jumping.
function takeGlideOffset(item: HTMLElement): Point {
  const running = item.getAnimations().filter((animation) => animation.id === GLIDE_ID);
  if (running.length === 0) return { x: 0, y: 0 };
  const [x, y] = getComputedStyle(item).translate.split(" ").map((part) => Number.parseFloat(part));
  running.forEach((animation) => animation.cancel());
  return { x: Number.isFinite(x) ? x : 0, y: Number.isFinite(y) ? y : 0 };
}

// A results list whose cards glide to their new spots when filters, sorting or
// layout change, instead of jumping. Positions are kept relative to the list,
// so scrolling never reads as movement. It only animates when the items change,
// so hovering, resizing and loading the page do nothing.
export default function FlipList({
  className,
  itemKey,
  children,
}: {
  className?: string;
  // Changes when the set or order of results changes.
  itemKey: string;
  children: React.ReactNode;
}) {
  const listRef = React.useRef<HTMLUListElement>(null);
  const previousRef = React.useRef<Map<string, Point> | null>(null);
  const previousKeyRef = React.useRef<string | null>(null);
  const glideRunRef = React.useRef(0);

  // Remember where everything sits just before the next change arrives.
  React.useLayoutEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const previous = previousRef.current;
    const changed = previousKeyRef.current !== null && previousKeyRef.current !== itemKey;
    previousKeyRef.current = itemKey;
    const current = readPositions(list);

    if (
      changed
      && previous
      && typeof list.animate === "function"
      && !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      const origin = list.getBoundingClientRect();
      const glides: Animation[] = [];
      for (const item of list.querySelectorAll<HTMLElement>(":scope > [data-flip-id]")) {
        const id = item.dataset.flipId as string;
        const now = current.get(id);
        if (!now) continue;
        const carried = takeGlideOffset(item);
        const top = origin.top + now.y;
        if (top > window.innerHeight + VIEWPORT_MARGIN || top + item.offsetHeight < -VIEWPORT_MARGIN) continue;
        const before = previous.get(id);
        if (!before) {
          item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: "ease-out" });
          continue;
        }
        const dx = before.x + carried.x - now.x;
        const dy = before.y + carried.y - now.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        const glide = item.animate(
          [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }],
          { duration: GLIDE_MS, easing: EASE },
        );
        glide.id = GLIDE_ID;
        glides.push(glide);
      }
      if (glides.length > 0) {
        // Grid to List starts wide rows at their old column, which would widen
        // the page for as long as they travel.
        const run = glideRunRef.current + 1;
        glideRunRef.current = run;
        list.style.overflowX = "clip";
        void Promise.allSettled(glides.map((glide) => glide.finished)).then(() => {
          if (run === glideRunRef.current) list.style.overflowX = "";
        });
      }
    }
    previousRef.current = current;
  }, [itemKey]);

  // Keep the remembered spots right if the layout shifts without a change of
  // results, such as a window resize or photos finishing loading.
  React.useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      previousRef.current = readPositions(list);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  // Relative makes the list the point its cards' offsets are measured from.
  return <ul ref={listRef} className={`relative ${className ?? ""}`}>{children}</ul>;
}
