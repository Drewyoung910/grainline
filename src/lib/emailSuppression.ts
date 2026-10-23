import { EmailSuppressionReason, Prisma } from "@prisma/client";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/db";
import { hashEmailForTelemetry } from "@/lib/privacyTelemetry";
import {
  emailSuppressionAddressKeys,
  emailSuppressionLookupForEmails,
  normalizeEmailAddress,
  normalizeEmailSuppressionAddress,
} from "./emailAddressNormalization.ts";
import { storeProviderSuppressionWithoutWeakeningDirectEvidence } from "./emailSuppressionWriteState.ts";

export { emailSuppressionAddressKeys, emailSuppressionLookupForEmails, normalizeEmailAddress, normalizeEmailSuppressionAddress };

type EmailSuppressionLookup = ReturnType<typeof emailSuppressionLookupForEmails>;
const RESEND_PROVIDER_SUPPRESSED_SOURCE = "resend_provider_suppressed";

function emailSuppressionMatchWhereSql(
  lookup: EmailSuppressionLookup,
  emailColumn: Prisma.Sql = Prisma.sql`"email"`,
) {
  const exactMatch = lookup.exactEmails.length > 0
    ? Prisma.sql`${emailColumn} IN (${Prisma.join(lookup.exactEmails)})`
    : Prisma.sql`false`;
  const gmailMatch = lookup.gmailLocalParts.length > 0
    ? Prisma.sql`(
        lower(split_part(${emailColumn}, '@', 2)) IN ('gmail.com', 'googlemail.com')
        AND replace(split_part(lower(split_part(${emailColumn}, '@', 1)), '+', 1), '.', '') IN (${Prisma.join(lookup.gmailLocalParts)})
      )`
    : Prisma.sql`false`;

  return Prisma.sql`(${exactMatch} OR ${gmailMatch})`;
}

async function emailSuppressionExists(
  email: string | null | undefined,
  predicate: Prisma.Sql = Prisma.empty,
): Promise<boolean> {
  const lookup = emailSuppressionLookupForEmails([email]);
  if (lookup.exactEmails.length === 0) return true;
  const [row] = await prisma.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id"
    FROM "EmailSuppression"
    WHERE ${emailSuppressionMatchWhereSql(lookup)}
      AND "source" IS DISTINCT FROM 'resend_transient_failure'
      ${predicate}
    LIMIT 1
  `);
  return !!row;
}

export async function isEmailSuppressed(email: string | null | undefined): Promise<boolean> {
  return emailSuppressionExists(email);
}

export async function isEmailSuppressedForNewsletterSignup(email: string | null | undefined): Promise<boolean> {
  return emailSuppressionExists(email, Prisma.sql`
    AND (
      "reason"::text IN (${EmailSuppressionReason.BOUNCE}, ${EmailSuppressionReason.COMPLAINT})
      OR "source" = 'account_deletion'
      OR ("reason"::text = ${EmailSuppressionReason.MANUAL} AND "source" IS NULL)
      OR ("reason"::text = ${EmailSuppressionReason.MANUAL} AND "source" <> 'one_click_unsubscribe')
    )
  `);
}

export async function isEmailDeliverySuppressed(email: string | null | undefined): Promise<boolean> {
  return emailSuppressionExists(email, Prisma.sql`
    AND (
      "reason"::text IN (${EmailSuppressionReason.BOUNCE}, ${EmailSuppressionReason.COMPLAINT})
      OR "source" = 'account_deletion'
    )
  `);
}

export async function clearOneClickEmailSuppression(
  email: string | null | undefined,
  client: Pick<Prisma.TransactionClient, "$executeRaw"> = prisma,
): Promise<number> {
  const lookup = emailSuppressionLookupForEmails([email]);
  if (lookup.exactEmails.length === 0) return 0;

  const deleted = await client.$executeRaw(Prisma.sql`
    DELETE FROM "EmailSuppression"
    WHERE ${emailSuppressionMatchWhereSql(lookup)}
      AND "reason"::text = ${EmailSuppressionReason.MANUAL}
      AND "source" = 'one_click_unsubscribe'
  `);

  return Number(deleted);
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
    const suppression = opts.source === RESEND_PROVIDER_SUPPRESSED_SOURCE
      ? await storeProviderSuppressionWithoutWeakeningDirectEvidence({
        updateMany: (args) => prisma.emailSuppression.updateMany(args),
        findUnique: (args) => prisma.emailSuppression.findUnique(args),
        create: (args) => prisma.emailSuppression.create(args),
      }, {
        email,
        reason: opts.reason,
        source: RESEND_PROVIDER_SUPPRESSED_SOURCE,
        eventId: opts.eventId,
        details: opts.details,
      })
      : await prisma.emailSuppression.upsert({
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
