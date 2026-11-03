"use client";

import * as React from "react";
import { growPhotoFrom, shrinkPhotoTo } from "@/lib/photoMotion";

// The full-screen photo viewer grows out of the photo it opened from and
// shrinks back into it. Closing waits for the shrink, and repeat presses of
// Escape or the close button while it runs do nothing extra.
export function usePhotoViewerMotion({
  open,
  photoRef,
  dialogRef,
  getSource,
  onClosed,
}: {
  open: boolean;
  photoRef: React.RefObject<HTMLImageElement | null>;
  dialogRef: React.RefObject<HTMLElement | null>;
  // The photo on the page to grow from and shrink to, right now.
  getSource: () => Element | null;
  onClosed: () => void;
}) {
  const closingRef = React.useRef(false);
  const latestRef = React.useRef({ getSource, onClosed });
  // Before the effect below, so opening measures the photo that was just chosen.
  React.useLayoutEffect(() => {
    latestRef.current = { getSource, onClosed };
  });

  React.useLayoutEffect(() => {
    if (!open) return;
    closingRef.current = false;
    growPhotoFrom(latestRef.current.getSource(), photoRef.current);
  }, [open, photoRef]);

  const closeViewer = React.useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    shrinkPhotoTo(latestRef.current.getSource(), photoRef.current, dialogRef.current, () => {
      closingRef.current = false;
      latestRef.current.onClosed();
    });
  }, [dialogRef, photoRef]);

  return { closeViewer };
}
