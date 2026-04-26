import { createHmac, timingSafeEqual } from "node:crypto";
import { EmailSuppressionReason } from "@prisma/client";
import { prisma } from "@/lib/db";
import { VALID_EMAIL_PREFERENCE_KEYS } from "@/lib/notifications";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";
const UNSUBSCRIBE_TOKEN_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const EMAIL_PREFS_TO_DISABLE = [...VALID_EMAIL_PREFERENCE_KEYS];

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

export function verifyUnsubscribeToken(email: string, token: string, issuedAtValue: string | number | null): boolean {
  const issuedAt = typeof issuedAtValue === "number" ? issuedAtValue : Number(issuedAtValue);
  if (!Number.isSafeInteger(issuedAt) || issuedAt <= 0) return false;
  if (Date.now() - issuedAt > UNSUBSCRIBE_TOKEN_TTL_MS || issuedAt - Date.now() > 5 * 60 * 1000) return false;

  const expected = createUnsubscribeToken(email, issuedAt);
  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected, "hex");
  const tokenBuffer = Buffer.from(token, "hex");
  if (expectedBuffer.length !== tokenBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, tokenBuffer);
}

export async function unsubscribeEmail(email: string): Promise<{ ok: boolean; userUpdated: boolean; newsletterUpdated: number }> {
  const normalized = normalizeUnsubscribeEmail(email);
  if (!normalized) return { ok: false, userUpdated: false, newsletterUpdated: 0 };

  let userUpdated = false;
  let newsletterUpdated = 0;

  await prisma.$transaction(async (tx) => {
    const newsletter = await tx.newsletterSubscriber.updateMany({
      where: { email: normalized, active: true },
      data: { active: false },
    });
    newsletterUpdated = newsletter.count;

    const user = await tx.user.findUnique({
      where: { email: normalized },
      select: { id: true, notificationPreferences: true },
    });

    if (user) {
      const preferences = {
        ...((user.notificationPreferences as Record<string, boolean>) ?? {}),
      };
      for (const key of EMAIL_PREFS_TO_DISABLE) {
        preferences[key] = false;
      }

      await tx.user.update({
        where: { id: user.id },
        data: { notificationPreferences: preferences },
      });
      userUpdated = true;
    }

    await tx.emailSuppression.upsert({
      where: { email: normalized },
      create: {
        email: normalized,
        reason: EmailSuppressionReason.MANUAL,
        source: "one_click_unsubscribe",
        details: { disabledPreferences: EMAIL_PREFS_TO_DISABLE },
      },
      update: {
        reason: EmailSuppressionReason.MANUAL,
        source: "one_click_unsubscribe",
        details: { disabledPreferences: EMAIL_PREFS_TO_DISABLE },
      },
    });
  });

  return { ok: true, userUpdated, newsletterUpdated };
}
