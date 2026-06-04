import { EmailSuppressionReason, Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import {
  emailSuppressionAddressKeys,
  normalizeEmailAddress,
  normalizeEmailSuppressionAddress,
} from "./emailAddressNormalization.ts";

export { emailSuppressionAddressKeys, normalizeEmailAddress, normalizeEmailSuppressionAddress };

export async function isEmailSuppressed(email: string | null | undefined): Promise<boolean> {
  const emails = emailSuppressionAddressKeys(email);
  if (emails.length === 0) return true;

  const suppression = await prisma.emailSuppression.findFirst({
    where: { email: { in: emails } },
    select: { id: true },
  });
  return !!suppression;
}

export async function isEmailDeliverySuppressed(email: string | null | undefined): Promise<boolean> {
  const emails = emailSuppressionAddressKeys(email);
  if (emails.length === 0) return true;

  const suppression = await prisma.emailSuppression.findFirst({
    where: {
      email: { in: emails },
      OR: [
        { reason: { in: [EmailSuppressionReason.BOUNCE, EmailSuppressionReason.COMPLAINT] } },
        { source: "account_deletion" },
      ],
    },
    select: { id: true },
  });
  return !!suppression;
}

export async function clearOneClickEmailSuppression(
  email: string | null | undefined,
  client: Pick<Prisma.TransactionClient, "emailSuppression"> = prisma,
): Promise<number> {
  const emails = emailSuppressionAddressKeys(email);
  if (emails.length === 0) return 0;

  const deleted = await client.emailSuppression.deleteMany({
    where: {
      email: { in: emails },
      reason: EmailSuppressionReason.MANUAL,
      source: "one_click_unsubscribe",
    },
  });

  return deleted.count;
}

export async function suppressEmail(opts: {
  email: string;
  reason: EmailSuppressionReason;
  source?: string;
  eventId?: string;
  details?: Prisma.InputJsonValue;
}) {
  const email = normalizeEmailSuppressionAddress(opts.email);
  if (!email) return null;
  const emailKeys = emailSuppressionAddressKeys(opts.email);

  try {
    const suppression = await prisma.emailSuppression.upsert({
      where: { email },
      create: {
        email,
        reason: opts.reason,
        source: opts.source,
        eventId: opts.eventId,
        details: opts.details ?? {},
      },
      update: {
        reason: opts.reason,
        source: opts.source,
        eventId: opts.eventId,
        details: opts.details ?? {},
      },
    });

    await prisma.newsletterSubscriber.updateMany({
      where: { email: { in: emailKeys.length > 0 ? emailKeys : [email] } },
      data: {
        active: false,
        confirmationTokenHash: null,
        confirmationExpiresAt: null,
        confirmationSentAt: null,
      },
    });

    return suppression;
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "email_suppression" },
      extra: { emailHash: hashEmailForTelemetry(email), reason: opts.reason, source: opts.source, eventId: opts.eventId },
    });
    throw err;
  }
}
