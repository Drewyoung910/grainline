import { createHash, timingSafeEqual } from "crypto";

export const ADMIN_PIN_SHA256_BY_CLERK_ID_ENV = "ADMIN_PIN_SHA256_BY_CLERK_ID";

type AdminPinDigestResolution =
  | { ok: true; digest: Buffer; source: "per-user" | "shared" }
  | { ok: false; reason: "missing_config" | "missing_user" | "invalid" };

const SHA256_HEX_PATTERN = /^[a-f0-9]{64}$/i;

export function adminPinSha256Hex(pin: string) {
  return createHash("sha256").update(pin).digest("hex");
}

function digestBufferFromHex(hex: string) {
  if (!SHA256_HEX_PATTERN.test(hex)) return null;
  return Buffer.from(hex, "hex");
}

function parseAdminPinDigestMap(raw: string) {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

    const entries: Record<string, string> = {};
    for (const [clerkUserId, digest] of Object.entries(parsed)) {
      if (typeof clerkUserId !== "string" || clerkUserId.trim() === "") return null;
      if (typeof digest !== "string" || !SHA256_HEX_PATTERN.test(digest)) return null;
      entries[clerkUserId] = digest.toLowerCase();
    }
    return entries;
  } catch {
    return null;
  }
}

export function resolveAdminPinDigestForUser({
  clerkUserId,
  perUserPinDigestsJson,
  sharedPin,
}: {
  clerkUserId: string;
  perUserPinDigestsJson?: string;
  sharedPin?: string;
}): AdminPinDigestResolution {
  const trimmedMap = perUserPinDigestsJson?.trim();
  if (trimmedMap) {
    const digestMap = parseAdminPinDigestMap(trimmedMap);
    if (!digestMap) return { ok: false, reason: "invalid" };

    const perUserDigest = digestMap[clerkUserId];
    if (!perUserDigest) return { ok: false, reason: "missing_user" };

    const digest = digestBufferFromHex(perUserDigest);
    return digest ? { ok: true, digest, source: "per-user" } : { ok: false, reason: "invalid" };
  }

  if (!sharedPin) return { ok: false, reason: "missing_config" };
  return {
    ok: true,
    digest: createHash("sha256").update(sharedPin).digest(),
    source: "shared",
  };
}

export function adminPinDigestMatches(pin: string, expectedDigest: Buffer) {
  const pinDigest = createHash("sha256").update(pin).digest();
  if (pinDigest.length !== expectedDigest.length) return false;
  return timingSafeEqual(pinDigest, expectedDigest);
}
