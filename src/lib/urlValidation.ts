const configuredPublicUrls = [
  process.env.CLOUDFLARE_R2_PUBLIC_URL,
  process.env.R2_PUBLIC_URL,
  process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL,
  process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
  process.env.CLOUDFLARE_R2_PUBLIC_URLS,
  process.env.ALLOWED_R2_PUBLIC_URLS,
]
  .filter(Boolean)
  .flatMap((value) => value!.split(","))
  .map((value) => value.trim())
  .filter(Boolean);

// First-party CDN domain used by existing production media.
const FIRST_PARTY_MEDIA_ORIGINS = ["https://cdn.thegrainline.com"];

// Legacy UploadThing media still exists in production data. Keep it renderable
// and preservable while new uploads continue to go through Grainline's R2 flow.
const LEGACY_MEDIA_ORIGINS = ["https://utfs.io", "https://ufs.sh", "https://qu5gyczaki.ufs.sh"];
const DISPLAY_ONLY_MEDIA_HOSTS = new Set(["i.postimg.cc"]);
const MAX_KEY_SEGMENT_LENGTH = 128;

function uploadKeyUserSegmentForValidation(userId: string): string {
  const segment = userId.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, MAX_KEY_SEGMENT_LENGTH);
  return segment || "user";
}

function normalizedUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

function matchesAllowedBase(candidate: URL, allowedBases: string[]): boolean {
  const bases = allowedBases
    .map((url) => normalizedUrl(url))
    .filter((url): url is URL => Boolean(url));

  for (const base of bases) {
    const basePath = base.pathname.replace(/\/$/, "");
    if (
      candidate.origin === base.origin &&
      (basePath === "" || candidate.pathname.startsWith(`${basePath}/`))
    ) {
      return true;
    }
  }

  return false;
}

export function isFirstPartyMediaUrl(input: string): boolean {
  const candidate = normalizedUrl(input);
  if (!candidate || candidate.protocol !== "https:") return false;

  return matchesAllowedBase(candidate, [...configuredPublicUrls, ...FIRST_PARTY_MEDIA_ORIGINS]);
}

export function filterFirstPartyMediaUrls(urls: string[], max: number): string[] {
  return urls.filter((url) => isFirstPartyMediaUrl(url)).slice(0, max);
}

export function firstPartyMediaKey(input: string): string | null {
  const candidate = normalizedUrl(input);
  if (!candidate || candidate.protocol !== "https:") return null;

  const allowedBases = [...configuredPublicUrls, ...FIRST_PARTY_MEDIA_ORIGINS]
    .map((url) => normalizedUrl(url))
    .filter((url): url is URL => Boolean(url));

  for (const base of allowedBases) {
    const basePath = base.pathname.replace(/\/$/, "");
    if (candidate.origin !== base.origin) continue;
    if (basePath && !candidate.pathname.startsWith(`${basePath}/`)) continue;
    let key: string;
    try {
      key = decodeURIComponent(candidate.pathname.slice(basePath.length).replace(/^\/+/, ""));
    } catch {
      return null;
    }
    if (!key || key.includes("..") || key.split("/").some((part) => part === "." || part === "..")) {
      return null;
    }
    return key;
  }

  return null;
}

export function isFirstPartyMediaUrlForUser(
  input: string,
  clerkUserId: string,
  allowedEndpoints?: readonly string[],
): boolean {
  const key = firstPartyMediaKey(input);
  if (!key) return false;

  const [endpoint, userSegment, ...rest] = key.split("/");
  if (!endpoint || !userSegment || rest.length === 0) return false;
  if (allowedEndpoints && !allowedEndpoints.includes(endpoint)) return false;
  return userSegment === uploadKeyUserSegmentForValidation(clerkUserId);
}

export function filterFirstPartyMediaUrlsForUser(
  urls: string[],
  max: number,
  clerkUserId: string,
  allowedEndpoints?: readonly string[],
): string[] {
  return urls
    .filter((url) => isFirstPartyMediaUrlForUser(url, clerkUserId, allowedEndpoints))
    .slice(0, max);
}

export function isR2PublicUrl(input: string): boolean {
  const candidate = normalizedUrl(input);
  if (!candidate || candidate.protocol !== "https:") return false;

  return matchesAllowedBase(candidate, [
    ...configuredPublicUrls,
    ...FIRST_PARTY_MEDIA_ORIGINS,
    ...LEGACY_MEDIA_ORIGINS,
  ]);
}

export function filterR2PublicUrls(urls: string[], max: number): string[] {
  return urls.filter((url) => isR2PublicUrl(url)).slice(0, max);
}

export function isTrustedMediaUrl(input: string): boolean {
  if (isR2PublicUrl(input)) return true;
  const candidate = normalizedUrl(input);
  return Boolean(candidate && candidate.protocol === "https:" && DISPLAY_ONLY_MEDIA_HOSTS.has(candidate.hostname));
}

export function filterTrustedMediaUrls(urls: string[], max: number): string[] {
  return urls.filter((url) => isTrustedMediaUrl(url)).slice(0, max);
}
