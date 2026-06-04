import { EmailSuppressionReason, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  emailSuppressionAddressKeys,
  normalizeEmailSuppressionAddress,
} from "@/lib/emailSuppression";
import { normalizeNotificationPreferences, VALID_EMAIL_PREFERENCE_KEYS } from "@/lib/notificationPreferenceKeys";
import { normalizeUnsubscribeEmail } from "@/lib/unsubscribeToken";

export {
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  normalizeUnsubscribeEmail,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribeToken";

const EMAIL_PREFS_TO_DISABLE = [...VALID_EMAIL_PREFERENCE_KEYS];
type EmailSuppressionClient = Pick<Prisma.TransactionClient, "emailSuppression">;

async function setOneClickEmailSuppression(tx: EmailSuppressionClient, email: string) {
  const suppressionEmail = normalizeEmailSuppressionAddress(email) ?? email;
  const suppressionEmailKeys = emailSuppressionAddressKeys(email);
  const emails = suppressionEmailKeys.length > 0 ? suppressionEmailKeys : [suppressionEmail];
  const details = { disabledPreferences: EMAIL_PREFS_TO_DISABLE };

  const existingSuppressions = await tx.emailSuppression.findMany({
    where: { email: { in: emails } },
    select: { email: true, reason: true, source: true },
  });
  const hasHardSuppression = existingSuppressions.some(
    (suppression) =>
      suppression.reason === EmailSuppressionReason.BOUNCE ||
      suppression.reason === EmailSuppressionReason.COMPLAINT ||
      suppression.source === "account_deletion",
  );
  if (hasHardSuppression) return;

  await tx.emailSuppression.updateMany({
    where: {
      email: { in: emails },
      reason: EmailSuppressionReason.MANUAL,
    },
    data: {
      source: "one_click_unsubscribe",
      eventId: null,
      details,
    },
  });

  if (!existingSuppressions.some((suppression) => suppression.email === suppressionEmail)) {
    await tx.emailSuppression.create({
      data: {
        email: suppressionEmail,
        reason: EmailSuppressionReason.MANUAL,
        source: "one_click_unsubscribe",
        details,
      },
    });
  }
}

export async function unsubscribeTokenSuperseded(
  email: string,
  issuedAtValue: string | number | null,
): Promise<boolean> {
  const normalized = normalizeUnsubscribeEmail(email);
  const issuedAt = typeof issuedAtValue === "number" ? issuedAtValue : Number(issuedAtValue);
  if (!normalized || !Number.isSafeInteger(issuedAt) || issuedAt <= 0) return true;

  const [user] = await prisma.$queryRaw<{ emailPreferenceOptInAt: Date | null }[]>`
    SELECT "emailPreferenceOptInAt"
    FROM "User"
    WHERE "email" = ${normalized}
    LIMIT 1
  `;
  if (user?.emailPreferenceOptInAt && user.emailPreferenceOptInAt.getTime() > issuedAt) return true;

  const newsletter = await prisma.newsletterSubscriber.findUnique({
    where: { email: normalized },
    select: { confirmedAt: true },
  });
  return !!newsletter?.confirmedAt && newsletter.confirmedAt.getTime() > issuedAt;
}

export async function unsubscribeEmail(email: string): Promise<{ ok: boolean; userUpdated: boolean; newsletterUpdated: number }> {
  const normalized = normalizeUnsubscribeEmail(email);
  if (!normalized) return { ok: false, userUpdated: false, newsletterUpdated: 0 };

  let userUpdated = false;
  let newsletterUpdated = 0;

  await prisma.$transaction(async (tx) => {
    const newsletter = await tx.newsletterSubscriber.updateMany({
      where: { email: normalized },
      data: {
        active: false,
        confirmationTokenHash: null,
        confirmationExpiresAt: null,
        confirmationSentAt: null,
      },
    });
    newsletterUpdated = newsletter.count;

    const user = await tx.user.findUnique({
      where: { email: normalized },
      select: { id: true, notificationPreferences: true },
    });

    if (user) {
      const preferences = normalizeNotificationPreferences(user.notificationPreferences);
      for (const key of EMAIL_PREFS_TO_DISABLE) {
        preferences[key] = false;
      }

      await tx.user.update({
        where: { id: user.id },
        data: { notificationPreferences: preferences },
      });
      userUpdated = true;
    }

    await setOneClickEmailSuppression(tx, normalized);
  });

  return { ok: true, userUpdated, newsletterUpdated };
}
