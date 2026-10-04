import type { Prisma } from "@prisma/client";
import type { EmailNotificationPreferenceKey } from "@/lib/notificationPreferenceKeys";

type UserEmailDeliveryClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type UserEmailDeliveryRecipient = {
  userId: string;
  name: string | null;
  email: string;
};

export type UserEmailAccountState =
  | "active"
  | "missing"
  | "banned"
  | "deleted"
  | "email_changed";

function validNormalizedEmail(email: unknown): email is string {
  return typeof email === "string"
    && email.length >= 3
    && email.length <= 254
    && email === email.trim().toLowerCase()
    && email.indexOf("@") > 0;
}

function validRecipient(
  row: UserEmailDeliveryRecipient | undefined,
): row is UserEmailDeliveryRecipient {
  return Boolean(
    row
    && typeof row.userId === "string"
    && (row.name === null || typeof row.name === "string")
    && validNormalizedEmail(row.email),
  );
}

function exactAccountState(
  rows: Array<{ state: string }>,
  operation: string,
): UserEmailAccountState {
  const state = rows[0]?.state;
  if (
    rows.length !== 1
    || !state
    || !["active", "missing", "banned", "deleted", "email_changed"].includes(state)
  ) {
    throw new Error(`${operation} returned an invalid result`);
  }
  return state as UserEmailAccountState;
}

export async function userEmailDeliveryRecipient(
  client: UserEmailDeliveryClient,
  input: {
    userId: string;
    preferenceKey?: EmailNotificationPreferenceKey | null;
  },
) {
  const rows = await client.$queryRaw<UserEmailDeliveryRecipient[]>`
    SELECT *
      FROM public.grainline_user_email_recipient(
        ${input.userId}::text,
        ${input.preferenceKey ?? null}::text
      )
  `;
  if (rows.length === 0) return null;
  const recipient = rows[0];
  if (
    rows.length !== 1
    || !validRecipient(recipient)
    || recipient.userId !== input.userId
  ) {
    throw new Error("User email recipient authority returned an invalid result");
  }
  return recipient;
}

export async function userEmailDeliveryRecipients(
  client: UserEmailDeliveryClient,
  input: {
    userIds: string[];
    preferenceKey: EmailNotificationPreferenceKey;
  },
) {
  if (input.userIds.length === 0) return [];
  const firstInputIndex = new Map<string, number>();
  input.userIds.forEach((userId, index) => {
    if (!firstInputIndex.has(userId)) firstInputIndex.set(userId, index);
  });
  const rows = await client.$queryRaw<UserEmailDeliveryRecipient[]>`
    SELECT *
      FROM public.grainline_user_email_recipient_batch(
        ${input.userIds}::text[],
        ${input.preferenceKey}::text
      )
  `;
  const returnedIds = new Set<string>();
  let priorInputIndex = -1;
  const validRows = rows.length <= firstInputIndex.size && rows.every((row) => {
    if (!validRecipient(row)) return false;
    const inputIndex = firstInputIndex.get(row.userId);
    if (
      inputIndex === undefined
      || returnedIds.has(row.userId)
      || inputIndex <= priorInputIndex
    ) {
      return false;
    }
    returnedIds.add(row.userId);
    priorInputIndex = inputIndex;
    return true;
  });
  if (!validRows) {
    throw new Error("User email recipient batch authority returned an invalid result");
  }
  return rows;
}

export async function userEmailAccountStateById(
  client: UserEmailDeliveryClient,
  input: { userId: string; expectedEmail: string },
) {
  const rows = await client.$queryRaw<Array<{ state: string }>>`
    SELECT public.grainline_user_email_account_state_by_id(
      ${input.userId}::text,
      ${input.expectedEmail}::text
    ) AS state
  `;
  return exactAccountState(rows, "User email account-state authority");
}

export async function userEmailAccountStateByEmail(
  client: UserEmailDeliveryClient,
  email: string,
) {
  const rows = await client.$queryRaw<Array<{ state: string }>>`
    SELECT public.grainline_user_email_account_state_by_email(
      ${email}::text
    ) AS state
  `;
  return exactAccountState(rows, "User email address-state authority");
}
