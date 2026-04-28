import { EmailSuppressionReason } from "@prisma/client";
import { prisma } from "@/lib/db";
import { VALID_EMAIL_PREFERENCE_KEYS } from "@/lib/notifications";
import { normalizeUnsubscribeEmail } from "@/lib/unsubscribeToken";

export {
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  normalizeUnsubscribeEmail,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribeToken";

const EMAIL_PREFS_TO_DISABLE = [...VALID_EMAIL_PREFERENCE_KEYS];

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
