import type { Prisma } from "@prisma/client";
import { emailSuppressionAddressKeys, normalizeEmailAddress } from "./emailAddressNormalization.ts";

type UserEmailAddressClient = Pick<Prisma.TransactionClient, "userEmailAddress">;
type UserEmailOwnerClient = Pick<Prisma.TransactionClient, "user">;

export type UserEmailAddressExportRow = {
  email: string;
  source: string | null;
  isCurrent: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
};

function normalizedExactEmail(email: string | null | undefined) {
  return normalizeEmailAddress(email);
}

export function uniqueAccountEmailAddresses(emails: Array<string | null | undefined>) {
  return [...new Set(emails.flatMap((email) => {
    const normalized = normalizedExactEmail(email);
    return normalized ? [normalized] : [];
  }))];
}

export function accountEmailSuppressionKeysForEmails(emails: Array<string | null | undefined>) {
  return [...new Set(uniqueAccountEmailAddresses(emails).flatMap((email) => emailSuppressionAddressKeys(email)))];
}

export async function accountEmailFallbackEmailsForUser(
  client: UserEmailOwnerClient,
  input: { userId: string; emails: Array<string | null | undefined> },
) {
  const emails = uniqueAccountEmailAddresses(input.emails);
  if (emails.length === 0) return [];
  const suppressionKeyCandidates = accountEmailSuppressionKeysForEmails(emails);
  const ownerEmailCandidates = [...new Set([...emails, ...suppressionKeyCandidates])];
  const needsGmailCollisionScan = suppressionKeyCandidates.some((email) => email.endsWith("@gmail.com"));

  const claimedByOtherActiveUsers = await client.user.findMany({
    where: {
      id: { not: input.userId },
      deletedAt: null,
      OR: [
        { email: { in: ownerEmailCandidates } },
        ...(needsGmailCollisionScan
          ? [
              { email: { endsWith: "@gmail.com" } },
              { email: { endsWith: "@googlemail.com" } },
            ]
          : []),
      ],
    },
    select: { email: true },
  });
  const blockedExactEmails = new Set(
    claimedByOtherActiveUsers.map((user) => normalizeEmailAddress(user.email)).filter(Boolean),
  );
  const blockedSuppressionKeys = new Set(accountEmailSuppressionKeysForEmails([...blockedExactEmails]));
  return emails.filter((email) => {
    if (blockedExactEmails.has(email)) return false;
    return !emailSuppressionAddressKeys(email).some((key) => blockedSuppressionKeys.has(key));
  });
}

function emailAddressSource(source: string | null | undefined) {
  return source ? source.slice(0, 80) : null;
}

export async function syncUserEmailAddressHistory(
  client: UserEmailAddressClient,
  input: {
    userId: string;
    previousEmail?: string | null;
    currentEmail?: string | null;
    source: string;
    now?: Date;
  },
) {
  const now = input.now ?? new Date();
  const previousEmail = normalizedExactEmail(input.previousEmail);
  const currentEmail = normalizedExactEmail(input.currentEmail);
  const source = emailAddressSource(input.source);

  if (!previousEmail && !currentEmail) return [];

  if (currentEmail) {
    await client.userEmailAddress.updateMany({
      where: { userId: input.userId, isCurrent: true, email: { not: currentEmail } },
      data: { isCurrent: false, lastSeenAt: now },
    });
  }

  if (previousEmail && previousEmail !== currentEmail) {
    await client.userEmailAddress.upsert({
      where: { userId_email: { userId: input.userId, email: previousEmail } },
      create: {
        userId: input.userId,
        email: previousEmail,
        source,
        isCurrent: false,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { isCurrent: false, lastSeenAt: now },
    });
  }

  if (currentEmail) {
    await client.userEmailAddress.upsert({
      where: { userId_email: { userId: input.userId, email: currentEmail } },
      create: {
        userId: input.userId,
        email: currentEmail,
        source,
        isCurrent: true,
        firstSeenAt: now,
        lastSeenAt: now,
      },
      update: { isCurrent: true, source, lastSeenAt: now },
    });
  }

  return uniqueAccountEmailAddresses([previousEmail, currentEmail]);
}

export async function userAccountEmailAddressState(
  client: UserEmailAddressClient,
  input: { userId: string; currentEmail?: string | null },
) {
  const rows = await client.userEmailAddress.findMany({
    where: { userId: input.userId },
    orderBy: [{ isCurrent: "desc" }, { lastSeenAt: "desc" }, { email: "asc" }],
    select: {
      email: true,
      source: true,
      isCurrent: true,
      firstSeenAt: true,
      lastSeenAt: true,
    },
  });
  const emails = uniqueAccountEmailAddresses([input.currentEmail, ...rows.map((row) => row.email)]);
  return {
    rows,
    emails,
  };
}
