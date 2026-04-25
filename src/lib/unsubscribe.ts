import { createHmac, timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/db";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";
const EMAIL_PREFS_TO_DISABLE = [
  "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
  "EMAIL_SELLER_BROADCAST",
  "EMAIL_NEW_FOLLOWER",
];

function unsubscribeSecret(): string | null {
  return (
    process.env.UNSUBSCRIBE_SECRET ||
    process.env.EMAIL_UNSUBSCRIBE_SECRET ||
    process.env.CLERK_WEBHOOK_SECRET ||
    process.env.STRIPE_WEBHOOK_SECRET ||
    null
  );
}

export function normalizeUnsubscribeEmail(email: string): string | null {
  const normalized = email.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(normalized) ? normalized : null;
}

export function createUnsubscribeToken(email: string): string | null {
  const normalized = normalizeUnsubscribeEmail(email);
  const secret = unsubscribeSecret();
  if (!normalized || !secret) return null;
  return createHmac("sha256", secret).update(normalized).digest("hex");
}

export function buildUnsubscribeUrl(email: string): string | null {
  const normalized = normalizeUnsubscribeEmail(email);
  const token = normalized ? createUnsubscribeToken(normalized) : null;
  if (!normalized || !token) return null;

  const url = new URL("/api/email/unsubscribe", APP_URL);
  url.searchParams.set("email", normalized);
  url.searchParams.set("token", token);
  return url.toString();
}

export function verifyUnsubscribeToken(email: string, token: string): boolean {
  const expected = createUnsubscribeToken(email);
  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected, "hex");
  const tokenBuffer = Buffer.from(token, "hex");
  if (expectedBuffer.length !== tokenBuffer.length) return false;
  return timingSafeEqual(expectedBuffer, tokenBuffer);
}

export async function unsubscribeEmail(email: string): Promise<{ ok: boolean; userUpdated: boolean; newsletterUpdated: number }> {
  const normalized = normalizeUnsubscribeEmail(email);
  if (!normalized) return { ok: false, userUpdated: false, newsletterUpdated: 0 };

  const user = await prisma.user.findUnique({
    where: { email: normalized },
    select: { id: true, notificationPreferences: true },
  });
  const newsletter = await prisma.newsletterSubscriber.updateMany({
    where: { email: normalized, active: true },
    data: { active: false },
  });

  if (!user) {
    return { ok: true, userUpdated: false, newsletterUpdated: newsletter.count };
  }

  const preferences = {
    ...((user.notificationPreferences as Record<string, boolean>) ?? {}),
  };
  for (const key of EMAIL_PREFS_TO_DISABLE) {
    preferences[key] = false;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { notificationPreferences: preferences },
  });

  return { ok: true, userUpdated: true, newsletterUpdated: newsletter.count };
}
