import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { NotificationType } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import {
  NOTIFICATION_LINK_MAX_LENGTH,
  limitNotificationText,
} from "@/lib/notificationPayload";
import { isEmailNotificationEnabled } from "@/lib/notificationEmailPreferences";
import { emailPreferenceLookupFailureAllowsSend } from "./notificationPreferenceState.ts";
import { logServerError } from "@/lib/serverErrorLogger";
import { createNotificationServiceRow } from "@/lib/notificationServiceAccess";
import type {
  NotificationRelatedUserFields,
  NotificationSourceFields,
} from "@/lib/notificationSources";

export {
  VALID_EMAIL_PREFERENCE_KEYS,
  VALID_IN_APP_PREFERENCE_KEYS,
  VALID_PREFERENCE_KEYS,
} from "@/lib/notificationPreferenceKeys";

function notificationTelemetryExtra({
  userId,
  link,
  dedupScope,
}: {
  userId: string;
  link?: string;
  dedupScope?: string;
}) {
  return {
    userId,
    hasLink: typeof link === "string" && link.length > 0,
    linkLength: typeof link === "string" ? Math.min(link.length, NOTIFICATION_LINK_MAX_LENGTH) : 0,
    hasDedupScope: Boolean(dedupScope),
  };
}

export async function shouldSendEmail(userId: string, prefKey: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true, banned: true, deletedAt: true },
    });
    if (!user || user.banned || user.deletedAt) return false; // don't email suspended/deleted users
    return isEmailNotificationEnabled(user.notificationPreferences, prefKey);
  } catch (e) {
    logServerError(e, {
      source: "email_preference_check",
      level: "warning",
      extra: { userId, prefKey, failClosed: true },
    });
    return emailPreferenceLookupFailureAllowsSend();
  }
}

type CreateNotificationInput = {
  userId: string;
  type: NotificationType;
  title: string;
  body: string;
  link?: string;
  dedupScope?: string;
} & NotificationSourceFields & NotificationRelatedUserFields;

export async function createNotification({
  userId,
  type,
  link,
  dedupScope,
  sourceType,
  sourceId,
  relatedUserId,
}: CreateNotificationInput) {
  try {
    const notificationSourceType = sourceType
      ? limitNotificationText(sourceType, 80)
      : undefined;
    const notificationSourceId = sourceId
      ? limitNotificationText(sourceId, 191)
      : undefined;
    const notificationId = await createNotificationServiceRow({
      notificationId: randomUUID(),
      userId,
      type,
      sourceType: notificationSourceType ?? null,
      sourceId: notificationSourceId ?? null,
      relatedUserId: relatedUserId ?? null,
    });
    return notificationId ? { id: notificationId } : null;
  } catch (error) {
    Sentry.captureException(error, {
      tags: { source: "create_notification", notificationType: type },
      extra: notificationTelemetryExtra({ userId, link, dedupScope }),
    });
    // Never let notification failures break the main flow
  }
}
