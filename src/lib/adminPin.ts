export const ADMIN_PIN_COOKIE_NAME = "admin-pin-verified";
export const ADMIN_PIN_MAX_AGE_SECONDS = 60 * 60 * 4;

const encoder = new TextEncoder();
const DEV_ADMIN_PIN_COOKIE_SECRET =
  process.env.ADMIN_PIN_COOKIE_SECRET_DEV || (process.env.NODE_ENV !== "production" ? crypto.randomUUID() : "");

function getCookieSecret() {
  return process.env.ADMIN_PIN_COOKIE_SECRET || DEV_ADMIN_PIN_COOKIE_SECRET;
}

function base64Url(bytes: ArrayBuffer) {
  let binary = "";
  for (const byte of new Uint8Array(bytes)) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

async function signPayload(payload: string, secret: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  return base64Url(signature);
}

function constantTimeEqual(a: string, b: string) {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function isAdminPinConfigured() {
  return Boolean(process.env.ADMIN_PIN);
}

export async function createAdminPinCookieValue(userId: string, now = Date.now()) {
  const secret = getCookieSecret();
  if (!secret) return null;
  const expiresAt = now + ADMIN_PIN_MAX_AGE_SECONDS * 1000;
  const payload = `${userId}.${expiresAt}`;
  const signature = await signPayload(payload, secret);
  return `v1.${expiresAt}.${signature}`;
}

export async function verifyAdminPinCookieValue(
  cookieValue: string | undefined,
  userId: string,
  now = Date.now(),
) {
  const secret = getCookieSecret();
  if (!secret || !cookieValue) return false;

  const [version, expiresAtRaw, signature] = cookieValue.split(".");
  if (version !== "v1" || !expiresAtRaw || !signature) return false;

  const expiresAt = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return false;

  const expected = await signPayload(`${userId}.${expiresAtRaw}`, secret);
  return constantTimeEqual(signature, expected);
}
