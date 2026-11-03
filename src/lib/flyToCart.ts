// Sends a small copy of a photo flying into the header cart after an
// add-to-cart (motion prototype). Purely decorative: it never blocks the add,
// and does nothing when motion is reduced, when there is no visible photo or
// cart icon, or when the browser lacks the Web Animations API. Returns the
// flight time in ms when it started an animation, otherwise 0.
export const FLY_TO_CART_MS = 700;

export function flyToCart(sourceSelector = "[data-fly-to-cart-source]"): number {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return 0;

  const source = document.querySelector<HTMLImageElement>(sourceSelector);
  const target = Array.from(document.querySelectorAll<HTMLElement>("[data-cart-target]")).find(
    (element) => element.getClientRects().length > 0,
  );
  if (!source || !target) return 0;
  const src = source.currentSrc || source.src;
  if (!src) return 0;

  const from = source.getBoundingClientRect();
  const to = target.getBoundingClientRect();
  if (from.width === 0 || to.width === 0) return 0;

  const size = Math.min(from.width, from.height, 160);
  const startX = from.left + from.width / 2 - size / 2;
  const startY = from.top + from.height / 2 - size / 2;
  const deltaX = to.left + to.width / 2 - (startX + size / 2);
  const deltaY = to.top + to.height / 2 - (startY + size / 2);

  const ghost = document.createElement("img");
  ghost.src = src;
  ghost.alt = "";
  ghost.setAttribute("aria-hidden", "true");
  Object.assign(ghost.style, {
    position: "fixed",
    left: `${startX}px`,
    top: `${startY}px`,
    width: `${size}px`,
    height: `${size}px`,
    objectFit: "cover",
    borderRadius: "16px",
    zIndex: "9998",
    pointerEvents: "none",
    boxShadow: "0 18px 40px -18px rgba(0, 0, 0, 0.5)",
  } satisfies Partial<CSSStyleDeclaration>);
  if (typeof ghost.animate !== "function") return 0;
  document.body.appendChild(ghost);

  const animation = ghost.animate(
    [
      { transform: "translate(0, 0) scale(1)", opacity: 1 },
      { transform: `translate(${deltaX * 0.5}px, ${deltaY * 0.5 - 40}px) scale(0.55)`, opacity: 0.9, offset: 0.55 },
      { transform: `translate(${deltaX}px, ${deltaY}px) scale(0.12)`, opacity: 0.3 },
    ],
    { duration: FLY_TO_CART_MS, easing: "cubic-bezier(0.65, 0, 0.35, 1)" },
  );
  const cleanup = () => ghost.remove();
  animation.onfinish = cleanup;
  animation.oncancel = cleanup;
  return FLY_TO_CART_MS;
}
