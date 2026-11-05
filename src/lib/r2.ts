import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { requiredProductionEnv } from "./env.ts";

const R2_ACCOUNT_ID = requiredProductionEnv("CLOUDFLARE_R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = requiredProductionEnv("CLOUDFLARE_R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = requiredProductionEnv("CLOUDFLARE_R2_SECRET_ACCESS_KEY");

export const r2 = new S3Client({
  region: "auto",
  endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
  // The browser PUTs to the presigned URL, and the Content-Security-Policy allows
  // only the exact account host. Bucket-in-host URLs would be refused before the
  // request left the page, so direct uploads must use the path form.
  forcePathStyle: true,
  // A presigned URL has no body to checksum. The default would sign the checksum
  // of an empty body into the URL.
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
  credentials: {
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
  },
});

export const R2_BUCKET = requiredProductionEnv("CLOUDFLARE_R2_BUCKET_NAME");
export const R2_PUBLIC_URL = requiredProductionEnv("CLOUDFLARE_R2_PUBLIC_URL");

export function privateR2BucketName() {
  const bucket = requiredProductionEnv("CLOUDFLARE_R2_PRIVATE_BUCKET_NAME");
  if (!bucket) {
    throw new Error("CLOUDFLARE_R2_PRIVATE_BUCKET_NAME env var is required.");
  }
  if (bucket === R2_BUCKET) {
    throw new Error(
      "CLOUDFLARE_R2_PRIVATE_BUCKET_NAME must differ from the public R2 bucket.",
    );
  }
  return bucket;
}

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

export async function deleteR2ObjectByKey(key: string) {
  await r2.send(new DeleteObjectCommand({ Bucket: R2_BUCKET, Key: key }));
}

export async function deletePrivateR2ObjectByKey(key: string) {
  await r2.send(
    new DeleteObjectCommand({ Bucket: privateR2BucketName(), Key: key }),
  );
}

export async function deleteR2ObjectByStorageClass(
  key: string,
  storageClass: string,
) {
  if (storageClass === "PRIVATE") {
    await deletePrivateR2ObjectByKey(key);
    return;
  }
  if (storageClass !== "PUBLIC") {
    throw new Error("Unsupported direct-upload storage class.");
  }
  await deleteR2ObjectByKey(key);
}

export async function deleteR2ObjectByUrl(url: string) {
  const key = extractR2KeyFromUrl(url);
  if (!key) return false;
  await deleteR2ObjectByKey(key);
  return true;
}

// Signs Content-Type as well as size, so a client cannot store a file under a
// different type than the one the route validated (for example text/html on the
// public CDN).
export function presignDirectUploadUrl(input: {
  bucket: string;
  key: string;
  contentType: string;
  size: number;
  cacheControl: string;
}) {
  const command = new PutObjectCommand({
    Bucket: input.bucket,
    Key: input.key,
    ContentType: input.contentType,
    ContentLength: input.size,
    CacheControl: input.cacheControl,
  });
  return getSignedUrl(r2, command, { expiresIn: 300, signableHeaders: new Set(["content-type"]) });
}
