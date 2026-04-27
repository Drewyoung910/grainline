import { DeleteObjectCommand, S3Client } from "@aws-sdk/client-s3";

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${process.env.CLOUDFLARE_R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  credentials: {
    accessKeyId: process.env.CLOUDFLARE_R2_ACCESS_KEY_ID!,
    secretAccessKey: process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY!,
  },
});

export const R2_BUCKET = process.env.CLOUDFLARE_R2_BUCKET_NAME!;
export const R2_PUBLIC_URL = process.env.CLOUDFLARE_R2_PUBLIC_URL!;

function configuredR2PublicBases(): URL[] {
  return [
    process.env.CLOUDFLARE_R2_PUBLIC_URL,
    process.env.R2_PUBLIC_URL,
    process.env.NEXT_PUBLIC_CLOUDFLARE_R2_PUBLIC_URL,
    process.env.NEXT_PUBLIC_R2_PUBLIC_URL,
    process.env.CLOUDFLARE_R2_PUBLIC_URLS,
    process.env.ALLOWED_R2_PUBLIC_URLS,
    "https://cdn.thegrainline.com",
  ]
    .filter(Boolean)
    .flatMap((value) => value!.split(","))
    .map((value) => value.trim())
    .filter(Boolean)
    .flatMap((value) => {
      try {
        return [new URL(value)];
      } catch {
        return [];
      }
    });
}

export function extractR2KeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    for (const publicBase of configuredR2PublicBases()) {
      if (parsed.origin !== publicBase.origin) continue;

      const basePath = publicBase.pathname.replace(/\/$/, "");
      if (basePath && !parsed.pathname.startsWith(`${basePath}/`)) continue;

      return decodeURIComponent(parsed.pathname.slice(basePath.length).replace(/^\//, ""));
    }
    return null;
  } catch {
    return null;
  }
}

export async function deleteR2ObjectByUrl(url: string) {
  const key = extractR2KeyFromUrl(url);
  if (!key) return false;
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
  return true;
}
