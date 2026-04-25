"use client";

import { useEffect, useRef } from "react";
import type { RefObject } from "react";

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
let scrollRestore:
  | {
      scrollY: number;
      bodyOverflow: string;
      bodyPosition: string;
      bodyTop: string;
      bodyWidth: string;
      htmlOverflow: string;
    }
  | null = null;

function visibleFocusableElements(root: HTMLElement) {
  return Array.from(root.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter((el) => {
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  });
}

export function useDialogFocus(
  open: boolean,
  dialogRef: RefObject<HTMLElement | null>,
  onClose: () => void
) {
  const onCloseRef = useRef(onClose);

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
      const first = visibleFocusableElements(dialog)[0];
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
        previouslyFocused.focus();
      }
    };
  }, [dialogRef, open]);
}

export function useBodyScrollLock(locked: boolean) {
  useEffect(() => {
    if (!locked) return;

    if (scrollLockCount === 0) {
      scrollRestore = {
        scrollY: window.scrollY,
        bodyOverflow: document.body.style.overflow,
        bodyPosition: document.body.style.position,
        bodyTop: document.body.style.top,
        bodyWidth: document.body.style.width,
        htmlOverflow: document.documentElement.style.overflow,
      };

      document.documentElement.style.overflow = "hidden";
      document.body.style.overflow = "hidden";
      document.body.style.position = "fixed";
      document.body.style.top = `-${scrollRestore.scrollY}px`;
      document.body.style.width = "100%";
    }

    scrollLockCount += 1;

    return () => {
      scrollLockCount = Math.max(0, scrollLockCount - 1);
      if (scrollLockCount > 0 || !scrollRestore) return;

      const restore = scrollRestore;
      scrollRestore = null;

      document.documentElement.style.overflow = restore.htmlOverflow;
      document.body.style.overflow = restore.bodyOverflow;
      document.body.style.position = restore.bodyPosition;
      document.body.style.top = restore.bodyTop;
      document.body.style.width = restore.bodyWidth;
      window.scrollTo(0, restore.scrollY);
    };
  }, [locked]);
}
