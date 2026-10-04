import type { Prisma } from "@prisma/client";
import type { NotificationPreferenceKey } from "@/lib/notificationPreferenceKeys";

type UserOwnerPrivateClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type BooleanOutcomeRow = {
  updated: boolean;
};

export type UserOwnerLegalAcceptance = {
  termsAcceptedAt: Date;
  termsVersion: string;
  ageAttestedAt: Date;
};

function exactBooleanOutcome(
  rows: BooleanOutcomeRow[],
  operation: string,
): boolean {
  const outcome = rows[0];
  if (
    rows.length !== 1
    || !outcome
    || typeof outcome.updated !== "boolean"
  ) {
    throw new Error(`${operation} authority returned an invalid result`);
  }
  return outcome.updated;
}

export async function updateUserOwnerShippingAddress(
  client: UserOwnerPrivateClient,
  input: {
    userId: string;
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string;
    postalCode: string;
    phone: string | null;
  },
) {
  const rows = await client.$queryRaw<BooleanOutcomeRow[]>`
    SELECT public.grainline_user_owner_shipping_address_update(
      ${input.userId}::text,
      ${input.name}::text,
      ${input.line1}::text,
      ${input.line2}::text,
      ${input.city}::text,
      ${input.state}::text,
      ${input.postalCode}::text,
      ${input.phone}::text
    ) AS updated
  `;
  return exactBooleanOutcome(rows, "Owner shipping address");
}

export async function acceptUserOwnerLegalTerms(
  client: UserOwnerPrivateClient,
  input: { userId: string; termsVersion: string },
) {
  const rows = await client.$queryRaw<UserOwnerLegalAcceptance[]>`
    SELECT *
      FROM public.grainline_user_owner_legal_acceptance(
        ${input.userId}::text,
        ${input.termsVersion}::text
      )
  `;
  const accepted = rows[0];
  if (
    rows.length !== 1
    || !accepted
    || !(accepted.termsAcceptedAt instanceof Date)
    || typeof accepted.termsVersion !== "string"
    || !(accepted.ageAttestedAt instanceof Date)
  ) {
    throw new Error("Owner legal acceptance authority returned an invalid result");
  }
  return accepted;
}

export async function updateUserOwnerNotificationPreference(
  client: UserOwnerPrivateClient,
  input: {
    userId: string;
    preferenceKey: NotificationPreferenceKey;
    enabled: boolean;
  },
) {
  const rows = await client.$queryRaw<BooleanOutcomeRow[]>`
    SELECT public.grainline_user_owner_notification_preference_update(
      ${input.userId}::text,
      ${input.preferenceKey}::text,
      ${input.enabled}::boolean
    ) AS updated
  `;
  return exactBooleanOutcome(rows, "Owner notification preference");
}
