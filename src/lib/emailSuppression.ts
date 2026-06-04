import { EmailSuppressionReason, Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";

export function normalizeEmailAddress(email: string | null | undefined): string | null {
  const normalized = email?.trim().normalize("NFC").toLowerCase();
  if (!normalized || !normalized.includes("@")) return null;
  return normalized;
}

function gmailSuppressionAddress(email: string) {
  const [local, domain, ...rest] = email.split("@");
  if (!local || !domain || rest.length > 0) return email;

  const normalizedDomain = domain === "googlemail.com" ? "gmail.com" : domain;
  if (normalizedDomain !== "gmail.com") return email;

  const baseLocal = local.split("+")[0]?.replaceAll(".", "");
  if (!baseLocal) return email;
  return `${baseLocal}@gmail.com`;
}

export function normalizeEmailSuppressionAddress(email: string | null | undefined): string | null {
  const normalized = normalizeEmailAddress(email);
  return normalized ? gmailSuppressionAddress(normalized) : null;
}

export function emailSuppressionAddressKeys(email: string | null | undefined): string[] {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return [];

  const suppression = normalizeEmailSuppressionAddress(normalized);
  return [...new Set([normalized, ...(suppression && suppression !== normalized ? [suppression] : [])])];
}

export async function isEmailSuppressed(email: string | null | undefined): Promise<boolean> {
  const emails = emailSuppressionAddressKeys(email);
  if (emails.length === 0) return true;

  const suppression = await prisma.emailSuppression.findFirst({
    where: { email: { in: emails } },
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
