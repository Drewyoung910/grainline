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

export function extractR2KeyFromUrl(url: string): string | null {
  try {
    const publicBase = new URL(R2_PUBLIC_URL);
    const parsed = new URL(url);
    if (parsed.origin !== publicBase.origin) return null;

    const basePath = publicBase.pathname.replace(/\/$/, "");
    if (basePath && !parsed.pathname.startsWith(`${basePath}/`)) return null;

    return decodeURIComponent(parsed.pathname.slice(basePath.length).replace(/^\//, ""));
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
