// Vector map pin shared by every maker map. MapLibre's default marker is a
// soft, shadowed teardrop; this pin stays sharp at any zoom and uses the
// brand espresso. Pass it as the marker element with anchor "bottom" so the
// pin's tip sits exactly on the location.
const SVG_NS = "http://www.w3.org/2000/svg";

export const MAP_PIN_WIDTH = 30;
export const MAP_PIN_HEIGHT = 38;

// MapLibre only labels its own default markers, so the pin names itself.
// Interactive maps override role and label with their own.
export function createMapPinElement(label = "Map marker"): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("role", "img");
  el.setAttribute("aria-label", label);
  el.style.width = `${MAP_PIN_WIDTH}px`;
  el.style.height = `${MAP_PIN_HEIGHT}px`;
  el.style.filter = "drop-shadow(0 3px 4px rgba(28, 25, 23, 0.3))";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("width", String(MAP_PIN_WIDTH));
  svg.setAttribute("height", String(MAP_PIN_HEIGHT));
  svg.setAttribute("viewBox", `0 0 ${MAP_PIN_WIDTH} ${MAP_PIN_HEIGHT}`);
  svg.setAttribute("aria-hidden", "true");
  svg.style.display = "block";

  const body = document.createElementNS(SVG_NS, "path");
  body.setAttribute("d", "M15 36.5s13-11.4 13-21.5A13 13 0 0 0 2 15c0 10.1 13 21.5 13 21.5Z");
  body.setAttribute("fill", "#2C1F1A");
  body.setAttribute("stroke", "#F7F5F0");
  body.setAttribute("stroke-width", "1.5");
  body.setAttribute("stroke-linejoin", "round");

  const dot = document.createElementNS(SVG_NS, "circle");
  dot.setAttribute("cx", "15");
  dot.setAttribute("cy", "15");
  dot.setAttribute("r", "4.75");
  dot.setAttribute("fill", "#F7F5F0");

  svg.append(body, dot);
  el.append(svg);
  return el;
}
