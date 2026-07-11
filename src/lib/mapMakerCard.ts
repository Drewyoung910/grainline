// src/lib/mapMakerCard.ts
// Client-side "maker card" content for map marker popups. Built with plain
// DOM APIs (textContent only — never innerHTML with user data) so seller
// names/taglines can't inject markup. Inline styles keep the popup styling
// deterministic inside maplibre's portal, outside normal component CSS flow.
"use client";

export type MakerCardData = {
  id: string;
  name: string;
  path: string;
  avatarUrl: string | null;
  photoUrl: string | null;
  guildLevel: string | null;
  city: string | null;
  state: string | null;
  tagline: string | null;
  rating: { avg: number; count: number } | null;
};

const ESPRESSO = "#2C1F1A";
const ESPRESSO_HOVER = "#3A2A24";
const CREAM_DARK = "#EFEAE0";

function safeHttpsUrl(url: unknown): string | null {
  return typeof url === "string" && /^https:\/\//i.test(url) ? url : null;
}

function locationText(city: string | null, state: string | null): string {
  return [city, state].filter(Boolean).join(", ");
}

/** Lightweight content shown the instant the popup opens, while the full
 * card is fetched. Same width as the card so the popup doesn't jump, and it
 * keeps a working shop link so a failed card fetch still leaves the user a
 * way through. */
export function buildMakerCardSkeleton(
  name: string,
  city: string | null | undefined,
  state: string | null | undefined,
  path: string
): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.width = "240px";
  wrap.style.padding = "14px";
  wrap.style.fontFamily = "inherit";

  const title = document.createElement("div");
  title.style.fontWeight = "600";
  title.style.fontSize = "14px";
  title.style.color = "#1a1a1a";
  title.textContent = name;
  wrap.appendChild(title);

  const loc = locationText(city ?? null, state ?? null);
  if (loc) {
    const locEl = document.createElement("div");
    locEl.style.fontSize = "12px";
    locEl.style.color = "#78716c";
    locEl.style.marginTop = "2px";
    locEl.textContent = loc;
    wrap.appendChild(locEl);
  }

  const link = document.createElement("a");
  link.href = path;
  link.textContent = "View shop";
  link.style.display = "inline-block";
  link.style.marginTop = "8px";
  link.style.fontSize = "12px";
  link.style.fontWeight = "500";
  link.style.color = "#57534e";
  link.style.textDecoration = "underline";
  wrap.appendChild(link);

  return wrap;
}

/** Full maker card. */
export function buildMakerCard(data: MakerCardData): HTMLElement {
  const wrap = document.createElement("div");
  wrap.style.width = "240px";
  wrap.style.fontFamily = "inherit";

  // Cover photo strip (banner or best listing photo)
  const photoUrl = safeHttpsUrl(data.photoUrl);
  const cover = document.createElement("div");
  cover.style.height = "96px";
  cover.style.background = CREAM_DARK;
  cover.style.overflow = "hidden";
  if (photoUrl) {
    const img = document.createElement("img");
    img.src = photoUrl;
    img.alt = "";
    img.loading = "lazy";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.display = "block";
    cover.appendChild(img);
  }
  wrap.appendChild(cover);

  const body = document.createElement("div");
  body.style.padding = "0 14px 14px";
  wrap.appendChild(body);

  // Avatar overlapping the cover
  const avatar = document.createElement("div");
  avatar.style.width = "48px";
  avatar.style.height = "48px";
  avatar.style.borderRadius = "999px";
  avatar.style.border = "3px solid #ffffff";
  avatar.style.background = CREAM_DARK;
  avatar.style.overflow = "hidden";
  avatar.style.marginTop = "-24px";
  avatar.style.position = "relative";
  const avatarUrl = safeHttpsUrl(data.avatarUrl);
  if (avatarUrl) {
    const img = document.createElement("img");
    img.src = avatarUrl;
    img.alt = "";
    img.loading = "lazy";
    img.style.width = "100%";
    img.style.height = "100%";
    img.style.objectFit = "cover";
    img.style.display = "block";
    avatar.appendChild(img);
  }
  body.appendChild(avatar);

  // Name + guild pill
  const nameRow = document.createElement("div");
  nameRow.style.marginTop = "8px";
  nameRow.style.display = "flex";
  nameRow.style.alignItems = "center";
  nameRow.style.gap = "6px";
  nameRow.style.flexWrap = "wrap";
  const name = document.createElement("div");
  name.style.fontWeight = "600";
  name.style.fontSize = "15px";
  name.style.color = "#1a1a1a";
  name.textContent = data.name;
  nameRow.appendChild(name);
  if (data.guildLevel === "GUILD_MEMBER" || data.guildLevel === "GUILD_MASTER") {
    const pill = document.createElement("span");
    pill.style.background = CREAM_DARK;
    pill.style.borderRadius = "999px";
    pill.style.padding = "2px 8px";
    pill.style.fontSize = "10px";
    pill.style.fontWeight = "600";
    // Matches GuildBadge label colors: green-900 for Member, gold for Master.
    pill.style.color = data.guildLevel === "GUILD_MASTER" ? "#B8960C" : "#14532d";
    pill.textContent = data.guildLevel === "GUILD_MASTER" ? "Guild Master" : "Guild Member";
    nameRow.appendChild(pill);
  }
  body.appendChild(nameRow);

  // Rating
  if (data.rating && data.rating.count > 0) {
    const rating = document.createElement("div");
    rating.style.fontSize = "12px";
    rating.style.color = "#57534e";
    rating.style.marginTop = "2px";
    const star = document.createElement("span");
    star.style.color = "#f59e0b";
    star.textContent = "★ ";
    rating.appendChild(star);
    rating.appendChild(
      document.createTextNode(
        `${(Math.round(data.rating.avg * 10) / 10).toFixed(1)} (${data.rating.count})`
      )
    );
    body.appendChild(rating);
  }

  // Location
  const loc = locationText(data.city, data.state);
  if (loc) {
    const locEl = document.createElement("div");
    locEl.style.fontSize = "12px";
    locEl.style.color = "#78716c";
    locEl.style.marginTop = "2px";
    locEl.textContent = loc;
    body.appendChild(locEl);
  }

  // Tagline (2-line clamp)
  if (data.tagline) {
    const tagline = document.createElement("div");
    tagline.style.fontSize = "12px";
    tagline.style.color = "#57534e";
    tagline.style.marginTop = "6px";
    tagline.style.display = "-webkit-box";
    tagline.style.webkitLineClamp = "2";
    tagline.style.webkitBoxOrient = "vertical";
    tagline.style.overflow = "hidden";
    tagline.textContent = data.tagline;
    body.appendChild(tagline);
  }

  // Visit Workshop CTA
  const cta = document.createElement("a");
  cta.href = data.path;
  cta.textContent = "Visit Workshop";
  cta.style.display = "block";
  cta.style.textAlign = "center";
  cta.style.background = ESPRESSO;
  cta.style.color = "#ffffff";
  cta.style.borderRadius = "8px";
  cta.style.padding = "9px 12px";
  cta.style.fontSize = "13px";
  cta.style.fontWeight = "600";
  cta.style.marginTop = "10px";
  cta.style.textDecoration = "none";
  cta.style.transition = "background-color 0.15s";
  cta.addEventListener("mouseenter", () => { cta.style.background = ESPRESSO_HOVER; });
  cta.addEventListener("mouseleave", () => { cta.style.background = ESPRESSO; });
  body.appendChild(cta);

  return wrap;
}

/** Fetches the maker card for a seller (with a per-map cache) and swaps it
 * into the popup. Falls back to the skeleton content on failure — the
 * skeleton already carries name/location/link context from the pin. */
export async function upgradeMakerPopup(
  popup: { setDOMContent: (node: Node) => unknown; isOpen: () => boolean },
  sellerId: string,
  cache: Map<string, MakerCardData | null>
): Promise<void> {
  if (cache.has(sellerId)) {
    const cached = cache.get(sellerId);
    if (cached) popup.setDOMContent(buildMakerCard(cached));
    return;
  }
  try {
    const res = await fetch(`/api/seller/${encodeURIComponent(sellerId)}/map-card`);
    if (!res.ok) {
      cache.set(sellerId, null);
      return;
    }
    const data = (await res.json()) as MakerCardData;
    if (!data || typeof data.id !== "string") {
      cache.set(sellerId, null);
      return;
    }
    cache.set(sellerId, data);
    if (popup.isOpen()) popup.setDOMContent(buildMakerCard(data));
  } catch {
    cache.set(sellerId, null);
  }
}
