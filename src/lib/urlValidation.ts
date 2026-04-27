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

function normalizedUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function isR2PublicUrl(input: string): boolean {
  const candidate = normalizedUrl(input);
  if (!candidate || candidate.protocol !== "https:") return false;

  const allowedBases = [...configuredPublicUrls, ...FIRST_PARTY_MEDIA_ORIGINS, ...LEGACY_MEDIA_ORIGINS]
    .map((url) => normalizedUrl(url))
    .filter((url): url is URL => Boolean(url));

  for (const r2Base of allowedBases) {
    const basePath = r2Base.pathname.replace(/\/$/, "");
    if (
      candidate.origin === r2Base.origin &&
      (basePath === "" || candidate.pathname.startsWith(`${basePath}/`))
    ) {
      return true;
    }
  }

  return false;
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
