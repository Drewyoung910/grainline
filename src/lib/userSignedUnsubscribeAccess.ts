import type { Prisma } from "@prisma/client";

type UserSignedUnsubscribeClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type SupersededRow = {
  superseded: boolean;
};

type UpdatedCountRow = {
  updatedCount: number;
};

export async function userSignedUnsubscribeTokenSuperseded(
  client: UserSignedUnsubscribeClient,
  input: { suppressionKeys: string[]; issuedAt: Date },
) {
  const rows = await client.$queryRaw<SupersededRow[]>`
    SELECT public.grainline_user_unsubscribe_token_superseded(
      ${input.suppressionKeys}::text[],
      ${input.issuedAt}::timestamp
    ) AS superseded
  `;
  const outcome = rows[0];
  if (
    rows.length !== 1
    || !outcome
    || typeof outcome.superseded !== "boolean"
  ) {
    throw new Error("User unsubscribe token authority returned an invalid result");
  }
  return outcome.superseded;
}

export async function disableUserSignedUnsubscribeEmailPreferences(
  client: UserSignedUnsubscribeClient,
  suppressionKeys: string[],
) {
  const rows = await client.$queryRaw<UpdatedCountRow[]>`
    SELECT public.grainline_user_unsubscribe_preferences_disable(
      ${suppressionKeys}::text[]
    ) AS "updatedCount"
  `;
  const outcome = rows[0];
  if (
    rows.length !== 1
    || !outcome
    || !Number.isSafeInteger(outcome.updatedCount)
    || outcome.updatedCount < 0
  ) {
    throw new Error("User unsubscribe preference authority returned an invalid result");
  }
  return outcome.updatedCount;
}
