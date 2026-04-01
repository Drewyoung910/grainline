import { prisma } from "@/lib/db";
import { NotificationType } from "@prisma/client";

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
