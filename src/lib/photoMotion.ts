// Moves a photo between two places on screen: into the full-screen viewer and
// back, and from a listing card into the listing page's gallery. Transform and
// opacity only, so nothing around it reflows. Every path does nothing under
// reduced motion and leaves the page correct if the animation never runs.
type Rect = Pick<DOMRect, "left" | "top" | "width" | "height">;

const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
export const PHOTO_GROW_MS = 340;
const PHOTO_SHRINK_MS = 240;
const LATE_PHOTO_MS = 200;

function motionAllowed(): boolean {
  return typeof window !== "undefined"
    && typeof document.body.animate === "function"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The transform that centers `from` inside `to`, as large as it can be without
// spilling out, or null when either has no size (hidden, or not laid out yet).
export function photoDeltaTransform(from: Rect, to: Rect): string | null {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return null;
  const scale = Math.min(to.width / from.width, to.height / from.height);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  if (!Number.isFinite(scale) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

// Grows the viewer's photo out of the photo that was clicked.
export function growPhotoFrom(source: Element | null, photo: HTMLImageElement | null): void {
  if (!source || !photo || !motionAllowed()) return;
  const run = () => {
    // The viewer may have closed while a late image was loading.
    if (!photo.isConnected || !source.isConnected) return;
    const transform = photoDeltaTransform(photo.getBoundingClientRect(), source.getBoundingClientRect());
    if (!transform) return;
    // This replaces the simple entrance the viewer otherwise plays.
    photo.parentElement?.getAnimations?.().forEach((animation) => animation.cancel());
    photo.animate([{ transform }, { transform: "none" }], { duration: PHOTO_GROW_MS, easing: EASE });
  };
  if (photo.complete && photo.naturalWidth > 0) {
    run();
    return;
  }
  // A photo still loading has no size to measure. If it arrives right away it
  // can still grow; later than that it just appears.
  const openedAt = performance.now();
  photo.addEventListener("load", () => {
    if (performance.now() - openedAt <= LATE_PHOTO_MS) run();
  }, { once: true });
}

// Shrinks it back, then calls done. Done always runs, even with no animation.
export function shrinkPhotoTo(
  target: Element | null,
  photo: HTMLImageElement | null,
  backdrop: Element | null,
  done: () => void,
): void {
  if (!target || !photo || !motionAllowed()) {
    done();
    return;
  }
  // Closing partway through the grow continues from wherever the photo is now.
  const startTransform = getComputedStyle(photo).transform;
  photo.getAnimations().forEach((animation) => animation.cancel());
  photo.parentElement?.getAnimations?.().forEach((animation) => animation.cancel());

  const to = target.getBoundingClientRect();
  const transform = photoDeltaTransform(photo.getBoundingClientRect(), to);
  // A thumbnail scrolled out of view is nowhere useful to fly to.
  const targetVisible = to.bottom > 0 && to.top < window.innerHeight && to.right > 0 && to.left < window.innerWidth;
  if (!transform || !targetVisible) {
    done();
    return;
  }
  if (backdrop) {
    backdrop.animate(
      [{ backgroundColor: getComputedStyle(backdrop).backgroundColor }, { backgroundColor: "rgba(0, 0, 0, 0)" }],
      { duration: PHOTO_SHRINK_MS, easing: "ease-out", fill: "forwards" },
    );
    for (const child of Array.from(backdrop.children)) {
      if (child.contains(photo)) continue;
      child.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 120, easing: "ease-out", fill: "forwards" });
    }
  }
  const animation = photo.animate([{ transform: startTransform }, { transform }], {
    duration: PHOTO_SHRINK_MS,
    easing: EASE,
    fill: "forwards",
  });
  animation.onfinish = done;
  animation.oncancel = done;
}

// ---------- Card photo into the listing gallery ----------

export const LISTING_PHOTO_TARGET_ATTRIBUTE = "data-listing-photo-target";
const TRAVEL_MS = 420;
const TARGET_WAIT_MS = 4000;
const LANDED_HOLD_MS = 900;
const FADE_MS = 160;

let activeFlyer: HTMLImageElement | null = null;

function discardFlyer(flyer: HTMLImageElement): void {
  flyer.remove();
  if (activeFlyer === flyer) activeFlyer = null;
}

function removeFlyer(flyer: HTMLImageElement): void {
  if (typeof flyer.animate === "function") {
    const fade = flyer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: "forwards" });
    fade.onfinish = () => discardFlyer(flyer);
    fade.oncancel = () => discardFlyer(flyer);
  } else {
    discardFlyer(flyer);
  }
  if (activeFlyer === flyer) activeFlyer = null;
}

// Only a plain click travels. A new tab or window stays where it is.
export function isPlainClick(event: {
  button: number;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

// A copy of the card photo floats over the page while the next page loads,
// then flies to the gallery as soon as its space exists, which the loading
// skeleton provides. If that never happens it fades out and nothing is left
// behind. The header stays above it.
export function startPhotoTravel(photo: HTMLImageElement | null, frame: Element | null, listingId: string): void {
  if (!photo || !frame || !motionAllowed() || !photo.complete || photo.naturalWidth === 0) return;
  // The frame, not the photo: a hovered card photo is zoomed past its frame.
  const from = frame.getBoundingClientRect();
  if (from.width <= 0 || from.height <= 0) return;
  if (from.bottom < 0 || from.top > window.innerHeight) return;

  if (activeFlyer) removeFlyer(activeFlyer);
  const flyer = document.createElement("img");
  flyer.src = photo.currentSrc || photo.src;
  flyer.alt = "";
  flyer.setAttribute("aria-hidden", "true");
  Object.assign(flyer.style, {
    position: "fixed",
    left: `${from.left}px`,
    top: `${from.top}px`,
    width: `${from.width}px`,
    height: `${from.height}px`,
    objectFit: "cover",
    borderRadius: "16px",
    zIndex: "40",
    pointerEvents: "none",
    transformOrigin: "center",
    willChange: "transform",
  });
  document.body.appendChild(flyer);
  activeFlyer = flyer;

  const startedAt = performance.now();
  const selector = `[${LISTING_PHOTO_TARGET_ATTRIBUTE}]`;

  const land = (target: Element) => {
    const to = target.getBoundingClientRect();
    const transform = photoDeltaTransform(from, to);
    if (!transform) {
      removeFlyer(flyer);
      return;
    }
    const animation = flyer.animate([{ transform: "none" }, { transform }], {
      duration: TRAVEL_MS,
      easing: EASE,
      fill: "forwards",
    });
    animation.onfinish = () => {
      // Hold over the gallery until its own photo has had a moment to arrive.
      const holdStart = performance.now();
      const hold = () => {
        if (flyer !== activeFlyer) return;
        const shown = document.querySelector<HTMLImageElement>(`${selector} img`);
        const ready = Boolean(shown?.complete && shown.naturalWidth > 0);
        if (ready || performance.now() - holdStart > LANDED_HOLD_MS) removeFlyer(flyer);
        else requestAnimationFrame(hold);
      };
      hold();
    };
    animation.oncancel = () => discardFlyer(flyer);
  };

  const waitForTarget = () => {
    if (flyer !== activeFlyer) return;
    const onListingPage = window.location.pathname.startsWith(`/listing/${listingId}`);
    const target = onListingPage ? document.querySelector(selector) : null;
    if (target && target.getBoundingClientRect().width > 0) {
      land(target);
      return;
    }
    if (performance.now() - startedAt > TARGET_WAIT_MS) {
      removeFlyer(flyer);
      return;
    }
    requestAnimationFrame(waitForTarget);
  };
  requestAnimationFrame(waitForTarget);
}
