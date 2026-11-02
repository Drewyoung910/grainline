import { Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import {
  applyEmailHardSuppression,
  type HardEmailSuppressionReason,
  type HardEmailSuppressionSource,
} from "./emailSuppressionAccess.ts";
import {
  emailSuppressionAddressKeys,
  emailSuppressionLookupForEmails,
  normalizeEmailAddress,
  normalizeEmailSuppressionAddress,
} from "./emailAddressNormalization.ts";
import {
  clearOneClickEmailSuppressionAuthority,
  emailSuppressionExistsAuthority,
  type EmailSuppressionMode,
} from "./emailServiceAccess.ts";

export { emailSuppressionAddressKeys, emailSuppressionLookupForEmails, normalizeEmailAddress, normalizeEmailSuppressionAddress };

async function emailSuppressionExists(
  email: string | null | undefined,
  mode: EmailSuppressionMode,
): Promise<boolean> {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return true;
  return emailSuppressionExistsAuthority(prisma, { email: normalized, mode });
}

export async function isEmailSuppressed(email: string | null | undefined): Promise<boolean> {
  return emailSuppressionExists(email, "any");
}

export async function isEmailSuppressedForNewsletterSignup(email: string | null | undefined): Promise<boolean> {
  return emailSuppressionExists(email, "newsletter");
}

export async function isEmailDeliverySuppressed(email: string | null | undefined): Promise<boolean> {
  return emailSuppressionExists(email, "delivery");
}

export async function clearOneClickEmailSuppression(
  email: string | null | undefined,
  client: Pick<Prisma.TransactionClient, "$queryRaw"> = prisma,
): Promise<number> {
  const normalized = normalizeEmailAddress(email);
  if (!normalized) return 0;
  return clearOneClickEmailSuppressionAuthority(client, normalized);
}

export async function suppressEmail(opts: {
  email: string;
  reason: HardEmailSuppressionReason;
  source: HardEmailSuppressionSource;
  eventId?: string;
  details?: Prisma.InputJsonValue;
}) {
  const email = normalizeEmailSuppressionAddress(opts.email);
  if (!email) return null;

  try {
    return await applyEmailHardSuppression(prisma, {
      email,
      reason: opts.reason,
      source: opts.source,
      eventId: opts.eventId,
      details: opts.details,
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { source: "email_suppression" },
      extra: { emailHash: hashEmailForTelemetry(email), reason: opts.reason, source: opts.source, eventId: opts.eventId },
    });
    throw err;
  }
}
