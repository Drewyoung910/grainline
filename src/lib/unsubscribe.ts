import { EmailSuppressionReason, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import {
  emailSuppressionAddressKeys,
  emailSuppressionLookupForEmails,
  normalizeEmailSuppressionAddress,
} from "@/lib/emailSuppression";
import {
  normalizeNotificationPreferences,
  VALID_EMAIL_PREFERENCE_KEYS,
} from "@/lib/notificationPreferenceKeys";
import { normalizeUnsubscribeEmail } from "@/lib/unsubscribeToken";

export {
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  normalizeUnsubscribeEmail,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribeToken";

const EMAIL_PREFS_TO_DISABLE = [...VALID_EMAIL_PREFERENCE_KEYS];
type EmailSuppressionClient = Pick<
  Prisma.TransactionClient,
  "emailSuppression"
>;
type EmailSuppressionLookupClient = Pick<Prisma.TransactionClient, "$queryRaw">;
type EmailSuppressionLookup = ReturnType<typeof emailSuppressionLookupForEmails>;

function emailSuppressionMatchWhereSql(
  lookup: EmailSuppressionLookup,
  emailColumn: Prisma.Sql = Prisma.sql`"email"`,
) {
  const exactMatch = lookup.exactEmails.length > 0
    ? Prisma.sql`${emailColumn} IN (${Prisma.join(lookup.exactEmails)})`
    : Prisma.sql`false`;
  const gmailMatch = lookup.gmailLocalParts.length > 0
    ? Prisma.sql`(
        split_part(${emailColumn}, '@', 2) IN ('gmail.com', 'googlemail.com')
        AND replace(split_part(split_part(${emailColumn}, '@', 1), '+', 1), '.', '') IN (${Prisma.join(lookup.gmailLocalParts)})
      )`
    : Prisma.sql`false`;

  return Prisma.sql`(${exactMatch} OR ${gmailMatch})`;
}

async function userIdsMatchingSuppressionLookup(
  client: EmailSuppressionLookupClient,
  lookup: EmailSuppressionLookup,
) {
  if (lookup.exactEmails.length === 0) return [];
  return client.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id"
    FROM "User"
    WHERE ${emailSuppressionMatchWhereSql(lookup)}
  `);
}

async function newsletterIdsMatchingSuppressionLookup(
  client: EmailSuppressionLookupClient,
  lookup: EmailSuppressionLookup,
) {
  if (lookup.exactEmails.length === 0) return [];
  return client.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT "id"
    FROM "NewsletterSubscriber"
    WHERE ${emailSuppressionMatchWhereSql(lookup)}
  `);
}

async function setOneClickEmailSuppression(
  tx: EmailSuppressionClient,
  email: string,
) {
  const suppressionEmail = normalizeEmailSuppressionAddress(email) ?? email;
  const suppressionEmailKeys = emailSuppressionAddressKeys(email);
  const emails =
    suppressionEmailKeys.length > 0 ? suppressionEmailKeys : [suppressionEmail];
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

  if (
    !existingSuppressions.some(
      (suppression) => suppression.email === suppressionEmail,
    )
  ) {
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
  const issuedAt =
    typeof issuedAtValue === "number" ? issuedAtValue : Number(issuedAtValue);
  if (!normalized || !Number.isSafeInteger(issuedAt) || issuedAt <= 0)
    return true;

  const suppressionEmailKeys = emailSuppressionAddressKeys(normalized);
  const emails =
    suppressionEmailKeys.length > 0 ? suppressionEmailKeys : [normalized];
  const lookup = emailSuppressionLookupForEmails(emails);

  const [newerAccountClaim] = await prisma.$queryRaw<{ createdAt: Date }[]>(Prisma.sql`
    SELECT "createdAt"
    FROM "User"
    WHERE ${emailSuppressionMatchWhereSql(lookup)}
      AND "deletedAt" IS NULL
      AND "createdAt" > ${new Date(issuedAt)}
    ORDER BY "createdAt" DESC
    LIMIT 1
  `);
  if (newerAccountClaim) return true;

  const [newerCurrentEmailClaim] = await prisma.$queryRaw<{ firstSeenAt: Date }[]>(Prisma.sql`
    SELECT uea."firstSeenAt"
    FROM "UserEmailAddress" uea
    INNER JOIN "User" u ON u."id" = uea."userId"
    WHERE ${emailSuppressionMatchWhereSql(lookup, Prisma.sql`uea."email"`)}
      AND uea."isCurrent" = true
      AND u."deletedAt" IS NULL
      AND uea."firstSeenAt" > ${new Date(issuedAt)}
    ORDER BY uea."firstSeenAt" DESC
    LIMIT 1
  `);
  if (newerCurrentEmailClaim) return true;

  const [user] = await prisma.$queryRaw<{ emailPreferenceOptInAt: Date | null }[]>(Prisma.sql`
    SELECT "emailPreferenceOptInAt"
    FROM "User"
    WHERE ${emailSuppressionMatchWhereSql(lookup)}
      AND "emailPreferenceOptInAt" IS NOT NULL
    ORDER BY "emailPreferenceOptInAt" DESC
    LIMIT 1
  `);
  if (
    user?.emailPreferenceOptInAt &&
    user.emailPreferenceOptInAt.getTime() > issuedAt
  )
    return true;

  const [newsletter] = await prisma.$queryRaw<{ confirmedAt: Date | null }[]>(Prisma.sql`
    SELECT "confirmedAt"
    FROM "NewsletterSubscriber"
    WHERE ${emailSuppressionMatchWhereSql(lookup)}
      AND "confirmedAt" IS NOT NULL
    ORDER BY "confirmedAt" DESC
    LIMIT 1
  `);
  return (
    !!newsletter?.confirmedAt && newsletter.confirmedAt.getTime() > issuedAt
  );
}

export async function unsubscribeEmail(
  email: string,
): Promise<{ ok: boolean; userUpdated: boolean; newsletterUpdated: number }> {
  const normalized = normalizeUnsubscribeEmail(email);
  if (!normalized)
    return { ok: false, userUpdated: false, newsletterUpdated: 0 };
  const suppressionEmailKeys = emailSuppressionAddressKeys(normalized);
  const emails =
    suppressionEmailKeys.length > 0 ? suppressionEmailKeys : [normalized];
  const lookup = emailSuppressionLookupForEmails(emails);

  let userUpdated = false;
  let newsletterUpdated = 0;

  await prisma.$transaction(async (tx) => {
    const newsletterIds = (await newsletterIdsMatchingSuppressionLookup(tx, lookup)).map((row) => row.id);
    if (newsletterIds.length > 0) {
      const newsletter = await tx.newsletterSubscriber.updateMany({
        where: { id: { in: newsletterIds } },
        data: {
          active: false,
          confirmationTokenHash: null,
          confirmationExpiresAt: null,
          confirmationSentAt: null,
        },
      });
      newsletterUpdated = newsletter.count;
    }

    const userIds = (await userIdsMatchingSuppressionLookup(tx, lookup)).map((row) => row.id);
    const users = await tx.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, notificationPreferences: true },
    });

    for (const user of users) {
      const preferences = normalizeNotificationPreferences(
        user.notificationPreferences,
      );
      for (const key of EMAIL_PREFS_TO_DISABLE) {
        preferences[key] = false;
      }

      await tx.user.update({
        where: { id: user.id },
        data: { notificationPreferences: preferences },
      });
    }
    userUpdated = users.length > 0;

    await setOneClickEmailSuppression(tx, normalized);
  });

  return { ok: true, userUpdated, newsletterUpdated };
}
