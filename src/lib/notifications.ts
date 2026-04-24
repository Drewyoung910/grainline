import { prisma } from "@/lib/db";
import { NotificationType } from "@prisma/client";

const DEFAULT_OFF_EMAIL_KEYS = ["EMAIL_SELLER_BROADCAST", "EMAIL_NEW_FOLLOWER"];

/** All valid notification preference keys. Shared between the preferences API
 *  route and anywhere else that needs to validate preference keys.
 *  Add new keys here when adding new notification types. */
export const VALID_PREFERENCE_KEYS = [
  // In-app notification types
  "NEW_MESSAGE", "NEW_ORDER", "ORDER_SHIPPED", "ORDER_DELIVERED",
  "CASE_OPENED", "CASE_MESSAGE", "CASE_RESOLVED",
  "CUSTOM_ORDER_REQUEST", "CUSTOM_ORDER_LINK",
  "VERIFICATION_APPROVED", "VERIFICATION_REJECTED",
  "BACK_IN_STOCK", "NEW_REVIEW", "LOW_STOCK", "NEW_FAVORITE",
  "NEW_BLOG_COMMENT", "BLOG_COMMENT_REPLY",
  "NEW_FOLLOWER", "FOLLOWED_MAKER_NEW_LISTING", "FOLLOWED_MAKER_NEW_BLOG",
  "SELLER_BROADCAST", "COMMISSION_INTEREST",
  "LISTING_APPROVED", "LISTING_REJECTED",
  // Email preference keys
  "EMAIL_NEW_MESSAGE", "EMAIL_NEW_ORDER", "EMAIL_CUSTOM_ORDER",
  "EMAIL_CASE_OPENED", "EMAIL_CASE_MESSAGE", "EMAIL_CASE_RESOLVED",
  "EMAIL_NEW_REVIEW", "EMAIL_FOLLOWED_MAKER_NEW_LISTING",
  "EMAIL_SELLER_BROADCAST", "EMAIL_NEW_FOLLOWER",
] as const;

export async function shouldSendEmail(userId: string, prefKey: string): Promise<boolean> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { notificationPreferences: true, banned: true },
    });
    if (user?.banned) return false; // don't email banned users
    const prefs = (user?.notificationPreferences as Record<string, boolean>) ?? {};
    if (DEFAULT_OFF_EMAIL_KEYS.includes(prefKey)) {
      return prefs[prefKey] === true;
    }
    return prefs[prefKey] !== false;
  } catch (e) {
    console.error("Failed to check email preference:", e);
    return true;
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
      select: { notificationPreferences: true },
    });
    const prefs = (user?.notificationPreferences as Record<string, boolean>) ?? {};
    if (prefs[type] === false) return null;

    return await prisma.notification.create({
      data: { userId, type, title, body, link },
    });
  } catch {
    // Never let notification failures break the main flow
  }
}
