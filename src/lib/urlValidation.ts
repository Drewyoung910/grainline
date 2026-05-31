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

function hostnameWithoutIpv6Brackets(hostname: string): string {
  return hostname.toLowerCase().replace(/^\[/, "").replace(/\]$/, "").replace(/\.+$/, "");
}

function ipv4Parts(hostname: string): [number, number, number, number] | null {
  if (!/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return null;
  const parts = hostname.split(".").map((part) => Number(part));
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return parts as [number, number, number, number];
}

function isNonPublicIpv4(hostname: string): boolean {
  const parts = ipv4Parts(hostname);
  if (!parts) return false;
  const [a, b] = parts;
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 0) ||
    (a === 192 && b === 168) ||
    (a === 198 && (b === 18 || b === 19)) ||
    a >= 224
  );
}

function isNonPublicIpv6(hostname: string): boolean {
  if (!hostname.includes(":")) return false;
  if (hostname === "::" || hostname === "::1" || hostname === "0:0:0:0:0:0:0:1") return true;
  if (hostname.startsWith("::ffff:")) return true;
  if (hostname.startsWith("2001:db8:")) return true;

  const firstHextet = hostname.split(":").find(Boolean);
  if (!firstHextet) return true;
  const first = Number.parseInt(firstHextet, 16);
  if (!Number.isFinite(first)) return true;
  return (first & 0xfe00) === 0xfc00 || (first & 0xffc0) === 0xfe80 || (first & 0xff00) === 0xff00;
}

export function isPublicHostname(hostname: string): boolean {
  const normalized = hostnameWithoutIpv6Brackets(hostname);
  if (!normalized) return false;
  if (isNonPublicIpv4(normalized) || isNonPublicIpv6(normalized)) return false;

  const labels = normalized.split(".");
  if (labels.includes("localhost") || labels.includes("internal") || labels[0] === "intranet") return false;
  if (labels.length < 2 && !ipv4Parts(normalized) && !normalized.includes(":")) return false;
  if (["test", "invalid", "localhost", "local", "lan", "home", "corp"].includes(labels[labels.length - 1] ?? "")) return false;
  for (const suffix of ["nip.io", "sslip.io", "xip.io", "localtest.me", "lvh.me", "vcap.me"]) {
    if (normalized === suffix || normalized.endsWith(`.${suffix}`)) return false;
  }
  return true;
}

export function normalizePublicHttpsUrl(input: string | null | undefined, maxLength = 500): string | null {
  const raw = input?.trim();
  if (!raw) return null;
  const url = normalizedUrl(raw);
  if (!url || url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  if (!isPublicHostname(url.hostname)) return null;
  url.hash = "";
  const normalized = url.toString();
  return normalized.length <= maxLength ? normalized : null;
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
  return isR2PublicUrl(input);
}

export function filterTrustedMediaUrls(urls: string[], max: number): string[] {
  return urls.filter((url) => isTrustedMediaUrl(url)).slice(0, max);
}

const ACCOUNT_DELETION_MEDIA_ENDPOINTS = [
  "bannerImage",
  "galleryImage",
  "listingImage",
  "listingVideo",
  "messageImage",
  "messageAny",
  "messageFile",
  "reviewPhoto",
] as const;

export function accountDeletionMediaUrlsForCleanup(urls: Iterable<string>, clerkUserId: string): string[] {
  return [...new Set(urls)]
    .filter((url) => isFirstPartyMediaUrlForUser(url, clerkUserId, ACCOUNT_DELETION_MEDIA_ENDPOINTS));
}
