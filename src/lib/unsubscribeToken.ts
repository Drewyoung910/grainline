import { createHmac, timingSafeEqual } from "node:crypto";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";
export const UNSUBSCRIBE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;

function unsubscribeSecret(): string | null {
  return process.env.UNSUBSCRIBE_SECRET || process.env.EMAIL_UNSUBSCRIBE_SECRET || null;
}

export function normalizeUnsubscribeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) ? normalized : null;
}

function unsubscribePayload(email: string, issuedAt: number): string {
  return `${email}:${issuedAt}`;
}

export function createUnsubscribeToken(email: string, issuedAt = Date.now()): string | null {
  const normalized = normalizeUnsubscribeEmail(email);
  const secret = unsubscribeSecret();
  if (!normalized || !secret) return null;
  return createHmac("sha256", secret).update(unsubscribePayload(normalized, issuedAt)).digest("hex");
}

export function buildUnsubscribeUrl(email: string): string | null {
  const normalized = normalizeUnsubscribeEmail(email);
  const issuedAt = Date.now();
  const token = normalized ? createUnsubscribeToken(normalized, issuedAt) : null;
  if (!normalized || !token) return null;

  const url = new URL("/api/email/unsubscribe", APP_URL);
  url.searchParams.set("email", normalized);
  url.searchParams.set("issuedAt", String(issuedAt));
  url.searchParams.set("token", token);
  return url.toString();
}

export function verifyUnsubscribeToken(
  email: string,
  token: string,
  issuedAtValue: string | number | null,
  now = Date.now(),
): boolean {
  const issuedAt = typeof issuedAtValue === "number" ? issuedAtValue : Number(issuedAtValue);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) return false;
  if (now - issuedAt > UNSUBSCRIBE_TOKEN_TTL_MS || issuedAt - now > 5 * 60 * 1000) return false;

  const expected = createUnsubscribeToken(email, issuedAt);
  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected, "hex");
  const tokenBuffer = Buffer.from(token, "hex");
  if (expectedBuffer.length !== tokenBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, tokenBuffer);
}
