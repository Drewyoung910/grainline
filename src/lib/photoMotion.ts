// Moves a photo between two places on screen: into the full-screen viewer and
// back, and from a listing card into the listing page's gallery. Transform and
// opacity only, so nothing around it reflows. Every path does nothing under
// reduced motion and leaves the page correct if the animation never runs.
type Rect = Pick<DOMRect, "left" | "top" | "width" | "height">;

const EASE = "cubic-bezier(0.2, 0.7, 0.2, 1)";
export const PHOTO_GROW_MS = 340;
const PHOTO_SHRINK_MS = 240;

function motionAllowed(): boolean {
  return typeof window !== "undefined"
    && typeof document.body.animate === "function"
    && !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

// The transform that makes `from` sit exactly over `to`, or null when either
// has no size (hidden, or not laid out yet).
export function photoDeltaTransform(from: Rect, to: Rect): string | null {
  if (from.width <= 0 || from.height <= 0 || to.width <= 0 || to.height <= 0) return null;
  const scale = to.width / from.width;
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  if (!Number.isFinite(scale) || !Number.isFinite(dx) || !Number.isFinite(dy)) return null;
  return `translate(${dx}px, ${dy}px) scale(${scale})`;
}

// Grows the viewer's photo out of the photo that was clicked.
export function growPhotoFrom(source: Element | null, photo: HTMLImageElement | null): void {
  if (!source || !photo || !motionAllowed()) return;
  const run = () => {
    const transform = photoDeltaTransform(photo.getBoundingClientRect(), source.getBoundingClientRect());
    if (!transform) return;
    photo.animate([{ transform }, { transform: "none" }], { duration: PHOTO_GROW_MS, easing: EASE });
  };
  // A photo that isn't ready has no size to measure. It simply appears.
  if (photo.complete && photo.naturalWidth > 0) run();
}

// Shrinks it back, then calls done. Done always runs, even with no animation.
export function shrinkPhotoTo(target: Element | null, photo: HTMLImageElement | null, done: () => void): void {
  if (!target || !photo || !motionAllowed()) {
    done();
    return;
  }
  const transform = photoDeltaTransform(photo.getBoundingClientRect(), target.getBoundingClientRect());
  if (!transform) {
    done();
    return;
  }
  const animation = photo.animate([{ transform: "none" }, { transform }], {
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

function removeFlyer(flyer: HTMLImageElement): void {
  if (typeof flyer.animate === "function") {
    const fade = flyer.animate([{ opacity: 1 }, { opacity: 0 }], { duration: FADE_MS, fill: "forwards" });
    fade.onfinish = () => flyer.remove();
    fade.oncancel = () => flyer.remove();
  } else {
    flyer.remove();
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
export function startPhotoTravel(photo: HTMLImageElement | null, listingId: string): void {
  if (!photo || !motionAllowed() || !photo.complete || photo.naturalWidth === 0) return;
  const from = photo.getBoundingClientRect();
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
    animation.oncancel = () => flyer.remove();
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
