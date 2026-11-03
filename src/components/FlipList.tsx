"use client";

import * as React from "react";

const GLIDE_MS = 420;
const ENTER_MS = 240;
const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
const VIEWPORT_MARGIN = 200;

type Point = { x: number; y: number };

function readPositions(list: HTMLElement): Map<string, Point> {
  const origin = list.getBoundingClientRect();
  const positions = new Map<string, Point>();
  for (const item of list.querySelectorAll<HTMLElement>(":scope > [data-flip-id]")) {
    const box = item.getBoundingClientRect();
    positions.set(item.dataset.flipId as string, { x: box.left - origin.left, y: box.top - origin.top });
  }
  return positions;
}

// Existing visible results glide to their new positions after a sort, filter,
// or layout change. The first render, ordinary resizing, off-screen rows, and
// reduced-motion visitors stay completely still.
export default function FlipList({
  className,
  itemKey,
  children,
}: {
  className?: string;
  itemKey: string;
  children: React.ReactNode;
}) {
  const listRef = React.useRef<HTMLUListElement>(null);
  const previousRef = React.useRef<Map<string, Point> | null>(null);
  const previousKeyRef = React.useRef<string | null>(null);

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
      for (const item of list.querySelectorAll<HTMLElement>(":scope > [data-flip-id]")) {
        const id = item.dataset.flipId as string;
        const now = current.get(id);
        if (!now) continue;
        const top = origin.top + now.y;
        if (top > window.innerHeight + VIEWPORT_MARGIN || top + item.offsetHeight < -VIEWPORT_MARGIN) continue;
        const before = previous.get(id);
        if (!before) {
          item.animate([{ opacity: 0 }, { opacity: 1 }], { duration: ENTER_MS, easing: "ease-out" });
          continue;
        }
        const dx = before.x - now.x;
        const dy = before.y - now.y;
        if (Math.abs(dx) < 1 && Math.abs(dy) < 1) continue;
        item.animate(
          [{ translate: `${dx}px ${dy}px` }, { translate: "0 0" }],
          { duration: GLIDE_MS, easing: EASE },
        );
      }
    }
    previousRef.current = current;
  }, [itemKey]);

  React.useEffect(() => {
    const list = listRef.current;
    if (!list || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      previousRef.current = readPositions(list);
    });
    observer.observe(list);
    return () => observer.disconnect();
  }, []);

  return <ul ref={listRef} className={className}>{children}</ul>;
}
