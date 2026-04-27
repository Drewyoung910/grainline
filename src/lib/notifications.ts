import { prisma } from "@/lib/db";
import { NotificationType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { createHash } from "crypto";

const DEFAULT_OFF_EMAIL_KEYS = ["EMAIL_SELLER_BROADCAST", "EMAIL_NEW_FOLLOWER"];

/** All valid notification preference keys. Shared between the preferences API
 *  route and anywhere else that needs to validate preference keys.
 *  Add new keys here when adding new notification types. */
export const VALID_IN_APP_PREFERENCE_KEYS = [
  // In-app notification types
  "NEW_MESSAGE", "NEW_ORDER", "ORDER_SHIPPED", "ORDER_DELIVERED",
  "CASE_OPENED", "CASE_MESSAGE", "CASE_RESOLVED",
  "CUSTOM_ORDER_REQUEST", "CUSTOM_ORDER_LINK",
  "VERIFICATION_APPROVED", "VERIFICATION_REJECTED",
  "BACK_IN_STOCK", "NEW_REVIEW", "LOW_STOCK", "NEW_FAVORITE",
  "NEW_BLOG_COMMENT", "BLOG_COMMENT_REPLY",
  "NEW_FOLLOWER", "FOLLOWED_MAKER_NEW_LISTING", "FOLLOWED_MAKER_NEW_BLOG",
  "SELLER_BROADCAST", "COMMISSION_INTEREST",
  "LISTING_APPROVED", "LISTING_REJECTED", "PAYMENT_DISPUTE", "PAYOUT_FAILED",
] as const;

export const VALID_EMAIL_PREFERENCE_KEYS = [
  // Email preference keys
  "EMAIL_NEW_MESSAGE", "EMAIL_NEW_ORDER", "EMAIL_ORDER_SHIPPED", "EMAIL_ORDER_DELIVERED",
  "EMAIL_CASE_OPENED", "EMAIL_CASE_MESSAGE", "EMAIL_CASE_RESOLVED",
  "EMAIL_CUSTOM_ORDER", "EMAIL_CUSTOM_ORDER_LINK",
  "EMAIL_VERIFICATION_APPROVED", "EMAIL_VERIFICATION_REJECTED",
  "EMAIL_BACK_IN_STOCK", "EMAIL_NEW_REVIEW", "EMAIL_LOW_STOCK", "EMAIL_NEW_FAVORITE",
  "EMAIL_NEW_BLOG_COMMENT", "EMAIL_BLOG_COMMENT_REPLY",
  "EMAIL_NEW_FOLLOWER", "EMAIL_FOLLOWED_MAKER_NEW_LISTING", "EMAIL_FOLLOWED_MAKER_NEW_BLOG",
  "EMAIL_SELLER_BROADCAST", "EMAIL_COMMISSION_INTEREST",
  "EMAIL_LISTING_APPROVED", "EMAIL_LISTING_REJECTED", "EMAIL_PAYMENT_DISPUTE", "EMAIL_PAYOUT_FAILED",
] as const;

export const VALID_PREFERENCE_KEYS = [
  ...VALID_IN_APP_PREFERENCE_KEYS,
  ...VALID_EMAIL_PREFERENCE_KEYS,
] as const;

function notificationDedupKey({
  userId,
  type,
  link,
}: {
  userId: string;
  type: NotificationType;
  link?: string;
}) {
  const bucket = new Date().toISOString().slice(0, 10);
  return createHash("sha256")
    .update([bucket, userId, type, link ?? ""].join("\u001f"))
    .digest("hex");
}

function isNotificationDedupError(error: unknown) {
  const err = error as { code?: string; meta?: { target?: string[] | string } };
  if (err.code !== "P2002") return false;
  const target = err.meta?.target;
  return Array.isArray(target)
    ? target.includes("dedupKey")
    : typeof target === "string" && target.includes("dedupKey");
}

export async function shouldSendEmail(userId: string, prefKey: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true, banned: true, deletedAt: true },
    });
    if (user?.banned || user?.deletedAt) return false; // don't email suspended/deleted users
    const prefs = (user?.notificationPreferences as Record<string, boolean>) ?? {};
    if (DEFAULT_OFF_EMAIL_KEYS.includes(prefKey)) {
      return prefs[prefKey] === true;
    }
    return prefs[prefKey] !== false;
  } catch (e) {
    console.error("Failed to check email preference:", e);
    return false;
  }
}

export async function createNotification({
  userId,
  type,
  title,
  body,
  link,
}: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
}) {
  try {
    // Check notification preferences — if explicitly disabled, skip
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true, banned: true, deletedAt: true },
    });
    if (!user || user.banned || user.deletedAt) return null;

    const prefs = (user?.notificationPreferences as Record<string, boolean>) ?? {};
    if (prefs[type] === false) return null;

    const dedupKey = notificationDedupKey({ userId, type, link });

    try {
      return await prisma.notification.create({
        data: { userId, type, title, body, link, dedupKey },
      });
    } catch (error) {
      if (isNotificationDedupError(error)) {
        return prisma.notification.findUnique({
          where: { userId_type_dedupKey: { userId, type, dedupKey } },
        });
      }
      throw error;
    }
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "create_notification", notificationType: type },
      extra: { userId, link },
    });
    // Never let notification failures break the main flow
  }
}
