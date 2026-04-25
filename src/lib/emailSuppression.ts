import { EmailSuppressionReason, Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";

export function normalizeEmailAddress(email: string | null | undefined): string | null {
  const normalized = email?.trim().toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

export async function isEmailSuppressed(email: string | null | undefined): Promise<boolean> {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return true;

  const suppression = await prisma.emailSuppression.findUnique({
    where: { email: normalized },
    select: { id: true },
  });
  return !!suppression;
}

export async function suppressEmail(opts: {
  email: string;
  reason: EmailSuppressionReason;
  source?: string;
  eventId?: string;
  details?: Prisma.InputJsonValue;
}) {
  const email = normalizeEmailAddress(opts.email);
  if (!email) return null;

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
      where: { email },
      data: { active: false },
    });

    return suppression;
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "email_suppression" },
      extra: { email, reason: opts.reason, source: opts.source, eventId: opts.eventId },
    });
    throw err;
  }
}
