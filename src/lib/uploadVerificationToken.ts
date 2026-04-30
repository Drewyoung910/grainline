import { createHmac, timingSafeEqual } from "crypto";

export const UPLOAD_VERIFICATION_TOKEN_TTL_MS = 5 * 60 * 1000;

export type UploadVerificationFields = {
  key: string;
  endpoint: string;
  expectedSize: number;
  contentType: string;
  expiresAt: number;
};

export type UploadVerificationToken = {
  token: string;
  expiresAt: number;
};

function uploadVerificationSecret() {
  return process.env.UPLOAD_VERIFICATION_SECRET ?? "";
}

function canonicalUploadVerificationInput({
  key,
  endpoint,
  expectedSize,
  contentType,
  expiresAt,
}: UploadVerificationFields) {
  return [
    key,
    endpoint,
    String(expectedSize),
    contentType.trim().toLowerCase(),
    String(expiresAt),
  ].join("\n");
}

function signUploadVerification(fields: UploadVerificationFields, secret: string) {
  return createHmac("sha256", secret)
    .update(canonicalUploadVerificationInput(fields))
    .digest("hex");
}

function safeEqualHex(a: string, b: string) {
  if (!/^[a-f0-9]{64}$/i.test(a) || !/^[a-f0-9]{64}$/i.test(b)) return false;
  return timingSafeEqual(Buffer.from(a, "hex"), Buffer.from(b, "hex"));
}

export function createUploadVerificationToken(
  fields: Omit<UploadVerificationFields, "expiresAt">,
  now = Date.now(),
): UploadVerificationToken | null {
  const secret = uploadVerificationSecret();
  if (!secret) return null;
  const expiresAt = now + UPLOAD_VERIFICATION_TOKEN_TTL_MS;
  const signedFields = { ...fields, expiresAt };
  return {
    token: signUploadVerification(signedFields, secret),
    expiresAt,
  };
}

export function verifyUploadVerificationToken(
  fields: UploadVerificationFields,
  token: string,
  now = Date.now(),
) {
  const secret = uploadVerificationSecret();
  if (!secret || fields.expiresAt < now) return false;
  const expected = signUploadVerification(fields, secret);
  return safeEqualHex(token, expected);
}

export function uploadKeyBelongsToUser(key: string, endpoint: string, clerkUserId: string) {
  if (!key.startsWith(`${endpoint}/${clerkUserId}/`)) return false;
  if (key.includes("..")) return false;
  return !key.split("/").some((part) => part === "." || part === "..");
}

export function uploadContentTypeMatches(actual: string | null | undefined, expected: string) {
  return (actual ?? "").split(";")[0].trim().toLowerCase() === expected.trim().toLowerCase();
}

export function uploadedObjectVerificationError({
  actualSize,
  expectedSize,
  maxSize,
  actualContentType,
  expectedContentType,
}: {
  actualSize: number;
  expectedSize: number;
  maxSize: number;
  actualContentType?: string | null;
  expectedContentType: string;
}) {
  if (!uploadContentTypeMatches(actualContentType, expectedContentType)) {
    return "Uploaded file type did not match the signed upload.";
  }
  if (actualSize <= 0 || actualSize !== expectedSize || actualSize > maxSize) {
    return "Uploaded file size did not match the signed upload.";
  }
  return null;
}
