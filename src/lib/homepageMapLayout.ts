const MAP_FRAME_BASE_CLASSES =
  "w-full min-w-0 lg:flex-1 overflow-hidden rounded-lg shadow-sm ring-1 ring-stone-200/70";

export function homepageMapFrameClassName(compact: boolean) {
  const heightClasses = compact
    ? "h-[300px] sm:h-[320px] lg:h-[340px]"
    : "h-[420px]";

  return `${heightClasses} ${MAP_FRAME_BASE_CLASSES}`;
}
