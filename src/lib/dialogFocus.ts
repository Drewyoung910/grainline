"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

const SPACE_ACTIVATED_SELECTOR =
  'button, a[href], summary, [role="button"], [role="link"], [role="checkbox"], [role="radio"], [role="switch"], [role="tab"], [role="menuitem"], [role="option"]';

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "iframe",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

let scrollLockCount = 0;
let removeScrollGuards: (() => void) | null = null;

export function isPageZoomed() {
  return (window.visualViewport?.scale ?? 1) > 1.01;
}

function scrollableAncestorCanMove(target: EventTarget | null, deltaY: number) {
  // A gesture can begin on an SVG child inside a scrollable control.
  let element = target instanceof Element ? target : null;
  while (element && element !== document.body && element !== document.documentElement) {
    const style = window.getComputedStyle(element);
    const scrollable = /(auto|scroll)/u.test(style.overflowY)
      && element.scrollHeight > element.clientHeight + 1;
    if (scrollable) {
      if (deltaY < 0 && element.scrollTop > 0) return true;
      if (deltaY > 0 && element.scrollTop + element.clientHeight < element.scrollHeight - 1) {
        return true;
      }
    }
    element = element.parentElement;
  }
  return false;
}

export function installScrollGuards() {
  let previousTouch: { clientX: number; clientY: number } | null = null;
  const onWheel = (event: WheelEvent) => {
    // ctrl+wheel is trackpad pinch/browser zoom. A zoomed page must remain
    // pannable for low-vision visitors.
    if (event.ctrlKey || isPageZoomed()) return;
    if (!scrollableAncestorCanMove(event.target, event.deltaY)) event.preventDefault();
  };
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    previousTouch = touch ? { clientX: touch.clientX, clientY: touch.clientY } : null;
  };
  const onTouchMove = (event: TouchEvent) => {
    if (event.touches.length > 1 || isPageZoomed()) return;
    const current = event.touches[0];
    if (!current || !previousTouch) {
      event.preventDefault();
      return;
    }
    const deltaX = previousTouch.clientX - current.clientX;
    const deltaY = previousTouch.clientY - current.clientY;
    previousTouch = { clientX: current.clientX, clientY: current.clientY };
    // Horizontal drags belong to sliders and swipeable media, not the page.
    if (Math.abs(deltaY) <= Math.abs(deltaX)) return;
    if (!scrollableAncestorCanMove(event.target, deltaY)) event.preventDefault();
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const target = event.target;
    if (
      target instanceof HTMLInputElement
      || target instanceof HTMLTextAreaElement
      || target instanceof HTMLSelectElement
      || (target instanceof HTMLElement && target.isContentEditable)
    ) {
      return;
    }
    // Space presses a focused button or link; cancelling it here would stop that.
    if (event.key === " " && target instanceof Element && target.closest(SPACE_ACTIVATED_SELECTOR)) return;
    const deltaY = event.key === "ArrowUp" || event.key === "PageUp" || (event.key === " " && event.shiftKey) || event.key === "Home"
      ? -Infinity
      : event.key === "ArrowDown" || event.key === "PageDown" || event.key === " " || event.key === "End"
        ? Infinity
        : null;
    if (deltaY !== null && !scrollableAncestorCanMove(target, deltaY)) event.preventDefault();
  };
  document.addEventListener("wheel", onWheel, { passive: false });
  document.addEventListener("touchstart", onTouchStart, { passive: true });
  document.addEventListener("touchmove", onTouchMove, { passive: false });
  document.addEventListener("keydown", onKeyDown);
  return () => {
    document.removeEventListener("wheel", onWheel);
    document.removeEventListener("touchstart", onTouchStart);
    document.removeEventListener("touchmove", onTouchMove);
    document.removeEventListener("keydown", onKeyDown);
  };
}

function visibleFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

export function useDialogFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void,
  options?: {
    /** "first" (default) focuses the first focusable element on open;
     * "container" focuses the dialog element itself (tabIndex={-1}) so a
     * pointer-opened dialog doesn't paint a focus ring on its first link. */
    initialFocus?: "first" | "container";
  }
) {
  const onCloseRef = useRef(onClose);
  const initialFocus = options?.initialFocus ?? "first";

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!open) return;

    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;

    const focusTimer = window.setTimeout(() => {
      const dialog = dialogRef.current;
      if (!dialog) return;
      const first =
        initialFocus === "container" ? null : visibleFocusableElements(dialog)[0];
      (first ?? dialog).focus();
    }, 0);

    function onKeyDown(event: KeyboardEvent) {
      const dialog = dialogRef.current;
      if (!dialog) return;

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = visibleFocusableElements(dialog);
      if (focusable.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", onKeyDown);
      if (previouslyFocused?.isConnected) {
        previouslyFocused.focus({ preventScroll: true });
      }
    };
  }, [dialogRef, open, initialFocus]);
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    if (scrollLockCount === 0) {
      removeScrollGuards = installScrollGuards();
    }

    scrollLockCount += 1;

    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount > 0) return;
      removeScrollGuards?.();
      removeScrollGuards = null;
    };
  }, [locked]);
}
