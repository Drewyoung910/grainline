const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL;

function normalizedUrl(input: string): URL | null {
  try {
    return new URL(input);
  } catch {
    return null;
  }
}

export function isR2PublicUrl(input: string): boolean {
  if (!R2_PUBLIC_URL) return true;

  const candidate = normalizedUrl(input);
  const r2Base = normalizedUrl(R2_PUBLIC_URL);
  if (!candidate || !r2Base) return false;

  return (
    candidate.protocol === "https:" &&
    candidate.origin === r2Base.origin &&
    candidate.pathname.startsWith(`${r2Base.pathname.replace(/\/$/, "")}/`)
  );
}

export function filterR2PublicUrls(urls: string[], max: number): string[] {
  return urls.filter((url) => isR2PublicUrl(url)).slice(0, max);
}
