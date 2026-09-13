const MAX_TRACKING_IDS = 50;
export const TRACKING_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24;

const COOKIE_OPTIONS = {
  maxAge: TRACKING_COOKIE_MAX_AGE_SECONDS,
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
};

type CookieReader = {
  get(name: string): { value: string } | undefined;
};

type CookieWriter = {
  set(
    name: string,
    value: string,
    options: typeof COOKIE_OPTIONS | { maxAge: number; path: string }
  ): void;
};

export function parseTrackingIds(value: string | undefined): string[] {
  if (!value) return [];
  const ids: string[] = [];
  const seen = new Set<string>();

  for (const rawId of value.split(",")) {
    const id = rawId.trim();
    if (!id || seen.has(id)) continue;
    ids.push(id);
    seen.add(id);
    if (ids.length >= MAX_TRACKING_IDS) break;
  }

  return ids;
}

export function hasTrackingCookie(
  cookieStore: CookieReader,
  aggregateCookieName: string,
  legacyCookieName: string,
  listingId: string
) {
  const aggregateIds = parseTrackingIds(cookieStore.get(aggregateCookieName)?.value);
  const hasLegacyCookie = Boolean(cookieStore.get(legacyCookieName));

  return {
    aggregateIds,
    hasLegacyCookie,
    hasTracked: hasLegacyCookie || aggregateIds.includes(listingId),
  };
}

export function setTrackingCookie(
  responseCookies: CookieWriter,
  aggregateCookieName: string,
  aggregateIds: string[],
  listingId: string,
  legacyCookieName?: string
) {
  const nextIds = [listingId, ...aggregateIds.filter((id) => id !== listingId)].slice(
    0,
    MAX_TRACKING_IDS
  );

  responseCookies.set(aggregateCookieName, nextIds.join(","), COOKIE_OPTIONS);

  if (legacyCookieName) {
    responseCookies.set(legacyCookieName, "", { maxAge: 0, path: "/" });
  }
}
