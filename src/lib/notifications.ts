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
    return await prisma.notification.create({
      data: { userId, type, title, body, link },
    });
  } catch {
    // Never let notification failures break the main flow
  }
}
