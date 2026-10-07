import type { Prisma } from "@prisma/client";
import type { DbUserContextTransactionClient } from "./dbUserContext.ts";
import { emailSuppressionAddressKeys, normalizeEmailAddress } from "./emailAddressNormalization.ts";

type UserEmailAddressClient = Pick<Prisma.TransactionClient, "$queryRaw">;
type UserEmailOwnerClient = DbUserContextTransactionClient;

export type UserEmailAddressExportRow = {
  email: string;
  source: string | null;
  isCurrent: boolean;
  firstSeenAt: Date;
  lastSeenAt: Date;
  currentSinceAt: Date;
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
) {
  const rows = await client.$queryRaw<Array<{ email: string }>>`
    SELECT * FROM public.grainline_user_email_fallback_addresses()
  `;
  if (rows.some((row) => (
    typeof row.email !== "string"
    || normalizedExactEmail(row.email) !== row.email
  ))) {
    throw new Error("User email fallback authority returned an invalid result");
  }
  return uniqueAccountEmailAddresses(rows.map((row) => row.email));
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
  },
) {
  const previousEmail = normalizedExactEmail(input.previousEmail);
  const currentEmail = normalizedExactEmail(input.currentEmail);
  const source = emailAddressSource(input.source);

  if (!currentEmail) return uniqueAccountEmailAddresses([previousEmail]);

  const rows = await client.$queryRaw<Array<{ syncedCount: number }>>`
    SELECT public.grainline_user_email_address_sync(
      ${input.userId}::text,
      ${currentEmail}::text,
      ${source}::text
    )::integer AS "syncedCount"
  `;
  if (rows.length !== 1 || rows[0]?.syncedCount !== 1) {
    throw new Error("User email-address sync authority returned an invalid result");
  }

  return uniqueAccountEmailAddresses([previousEmail, currentEmail]);
}

export async function userAccountEmailAddressState(
  client: DbUserContextTransactionClient,
  input: { currentEmail?: string | null },
) {
  const rows = await client.$queryRaw<UserEmailAddressExportRow[]>`
    SELECT *
      FROM public.grainline_user_email_address_owner_rows()
  `;
  if (!Array.isArray(rows) || rows.some((row) => (
    typeof row.email !== "string"
    || (row.source !== null && typeof row.source !== "string")
    || typeof row.isCurrent !== "boolean"
    || !(row.firstSeenAt instanceof Date)
    || !(row.lastSeenAt instanceof Date)
    || !(row.currentSinceAt instanceof Date)
  ))) {
    throw new Error("User email-address owner authority returned an invalid result");
  }
  const emails = uniqueAccountEmailAddresses([input.currentEmail, ...rows.map((row) => row.email)]);
  return {
    rows,
    emails,
  };
}

export async function deleteCurrentUserEmailAddressHistory(
  client: DbUserContextTransactionClient,
) {
  const rows = await client.$queryRaw<Array<{ deletedCount: number }>>`
    SELECT public.grainline_user_email_address_delete_for_current_user()::integer
      AS "deletedCount"
  `;
  const deletedCount = rows[0]?.deletedCount;
  if (
    rows.length !== 1
    || typeof deletedCount !== "number"
    || !Number.isSafeInteger(deletedCount)
    || deletedCount < 0
  ) {
    throw new Error("User email-address deletion authority returned an invalid result");
  }
  return { count: deletedCount };
}
