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

  const allowedBases = [...configuredPublicUrls, ...FIRST_PARTY_MEDIA_ORIGINS]
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

  // Legacy Cloudflare R2 public bucket URLs look like
  // https://pub-xxxxx.r2.dev/key. Grainline previously stored those before the
  // cdn.thegrainline.com custom domain. Allow them as hosted media, but still
  // reject arbitrary HTTPS/CDN URLs.
  return candidate.hostname.endsWith(".r2.dev");
}

export function filterR2PublicUrls(urls: string[], max: number): string[] {
  return urls.filter((url) => isR2PublicUrl(url)).slice(0, max);
}
