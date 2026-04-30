import { prisma } from "@/lib/db";
import { NotificationType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { notificationDedupKey } from "@/lib/notificationDedup";
import {
  NOTIFICATION_BODY_MAX_LENGTH,
  NOTIFICATION_LINK_MAX_LENGTH,
  NOTIFICATION_TITLE_MAX_LENGTH,
  limitNotificationText,
} from "@/lib/notificationPayload";
import { isInAppNotificationEnabled } from "@/lib/notificationDeliveryPreferences";
import { emailPreferenceDefaultEnabled } from "@/lib/notificationEmailPreferences";

export {
  VALID_EMAIL_PREFERENCE_KEYS,
  VALID_IN_APP_PREFERENCE_KEYS,
  VALID_PREFERENCE_KEYS,
} from "@/lib/notificationPreferenceKeys";

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
    if (!user || user.banned || user.deletedAt) return false; // don't email suspended/deleted users
    const prefs = (user?.notificationPreferences as Record<string, boolean>) ?? {};
    if (!emailPreferenceDefaultEnabled(prefKey)) {
      return prefs[prefKey] === true;
    }
    return prefs[prefKey] !== false;
  } catch (e) {
    console.error("Failed to check email preference:", e);
    const fallbackEnabled = emailPreferenceDefaultEnabled(prefKey);
    Sentry.captureException(e, {
      tags: { source: "email_preference_check" },
      extra: { userId, prefKey, fallbackEnabled },
    });
    return fallbackEnabled;
  }
}

export async function createNotification({
  userId,
  type,
  title,
  body,
  link,
  dedupScope,
}: {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  dedupScope?: string;
}) {
  try {
    // Check notification preferences — if explicitly disabled, skip
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true, banned: true, deletedAt: true },
    });
    if (!user || user.banned || user.deletedAt) return null;

    const prefs = (user?.notificationPreferences as Record<string, boolean>) ?? {};
    if (!isInAppNotificationEnabled(prefs, type)) return null;

    const notificationTitle = limitNotificationText(title, NOTIFICATION_TITLE_MAX_LENGTH);
    const notificationBody = limitNotificationText(body, NOTIFICATION_BODY_MAX_LENGTH);
    const notificationLink = link
      ? limitNotificationText(link, NOTIFICATION_LINK_MAX_LENGTH)
      : undefined;
    const dedupKey = notificationDedupKey({ userId, type, link: notificationLink, dedupScope });

    try {
      return await prisma.notification.create({
        data: {
          userId,
          type,
          title: notificationTitle,
          body: notificationBody,
          link: notificationLink,
          dedupKey,
        },
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
