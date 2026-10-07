import type { Prisma } from "@prisma/client";

type UserAccountDeletionClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type UserProviderDeletedDeferredRow = {
  id: string;
  email: string;
  name: string | null;
};

export type UserAccountDeletionPreflight = {
  userId: string;
  clerkId: string;
  deletedAt: Date | null;
  sellerProfileId: string | null;
  stripeAccountId: string | null;
  stripeAccountVersion: string | null;
  stripeControllerType: string | null;
};

export type UserAccountDeletionSnapshot = {
  userId: string;
  clerkId: string;
  email: string;
  name: string | null;
  deletedAt: Date | null;
  shippingName: string | null;
  shippingLine1: string | null;
  shippingLine2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostalCode: string | null;
  shippingPhone: string | null;
  sellerProfileId: string | null;
  sellerDisplayName: string | null;
  sellerCity: string | null;
  sellerState: string | null;
  sellerShipFromName: string | null;
  sellerShipFromLine1: string | null;
  sellerShipFromLine2: string | null;
  sellerShipFromCity: string | null;
  sellerShipFromState: string | null;
  sellerShipFromPostal: string | null;
  sellerShipFromPhone: string | null;
  sellerTagline: string | null;
  sellerBannerImageUrl: string | null;
  sellerAvatarImageUrl: string | null;
  sellerWorkshopImageUrl: string | null;
  sellerInstagramUrl: string | null;
  sellerFacebookUrl: string | null;
  sellerPinterestUrl: string | null;
  sellerTiktokUrl: string | null;
  sellerWebsiteUrl: string | null;
};

type UserAccountDeletionFinalized = {
  userId: string;
  clerkId: string;
  email: string;
  deletedAt: Date;
};

function optionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function optionalDate(value: unknown): value is Date | null {
  return value === null || value instanceof Date;
}

function validPreflight(
  row: UserAccountDeletionPreflight | undefined,
): row is UserAccountDeletionPreflight {
  return Boolean(
    row
    && typeof row.userId === "string"
    && typeof row.clerkId === "string"
    && optionalDate(row.deletedAt)
    && optionalString(row.sellerProfileId)
    && optionalString(row.stripeAccountId)
    && optionalString(row.stripeAccountVersion)
    && optionalString(row.stripeControllerType),
  );
}

function validSnapshot(
  row: UserAccountDeletionSnapshot | undefined,
): row is UserAccountDeletionSnapshot {
  if (!row || typeof row.userId !== "string" || typeof row.clerkId !== "string"
      || typeof row.email !== "string" || !optionalDate(row.deletedAt)) return false;
  return [
    row.name,
    row.shippingName,
    row.shippingLine1,
    row.shippingLine2,
    row.shippingCity,
    row.shippingState,
    row.shippingPostalCode,
    row.shippingPhone,
    row.sellerProfileId,
    row.sellerDisplayName,
    row.sellerCity,
    row.sellerState,
    row.sellerShipFromName,
    row.sellerShipFromLine1,
    row.sellerShipFromLine2,
    row.sellerShipFromCity,
    row.sellerShipFromState,
    row.sellerShipFromPostal,
    row.sellerShipFromPhone,
    row.sellerTagline,
    row.sellerBannerImageUrl,
    row.sellerAvatarImageUrl,
    row.sellerWorkshopImageUrl,
    row.sellerInstagramUrl,
    row.sellerFacebookUrl,
    row.sellerPinterestUrl,
    row.sellerTiktokUrl,
    row.sellerWebsiteUrl,
  ].every(optionalString);
}

export async function deferProviderDeletedUserAccount(
  client: UserAccountDeletionClient,
  input: { clerkId: string; expectedUserId: string },
) {
  const rows = await client.$queryRaw<UserProviderDeletedDeferredRow[]>`
    SELECT * FROM public.grainline_user_provider_deleted_defer(
      ${input.clerkId}::text
    )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || row.id !== input.expectedUserId
    || typeof row.email !== "string"
    || !optionalString(row.name)
  ) {
    throw new Error("Provider-deleted User authority returned an invalid result");
  }
  return row;
}

export async function getUserAccountDeletionPreflight(
  client: UserAccountDeletionClient,
  sideEffectId: string,
) {
  const rows = await client.$queryRaw<UserAccountDeletionPreflight[]>`
    SELECT * FROM public.grainline_user_account_deletion_preflight(
      ${sideEffectId}::text
    )
  `;
  const row = rows[0];
  if (rows.length !== 1 || !validPreflight(row)) {
    throw new Error("User account-deletion preflight returned an invalid result");
  }
  return row;
}

export async function getUserAccountDeletionSnapshot(
  client: UserAccountDeletionClient,
  sideEffectId: string,
) {
  const rows = await client.$queryRaw<UserAccountDeletionSnapshot[]>`
    SELECT * FROM public.grainline_user_account_deletion_snapshot(
      ${sideEffectId}::text
    )
  `;
  const row = rows[0];
  if (rows.length !== 1 || !validSnapshot(row)) {
    throw new Error("User account-deletion snapshot returned an invalid result");
  }
  return row;
}

export async function finalizeUserAccountDeletion(
  client: UserAccountDeletionClient,
  input: { sideEffectId: string; expectedUserId: string },
) {
  const rows = await client.$queryRaw<UserAccountDeletionFinalized[]>`
    SELECT * FROM public.grainline_user_account_deletion_finalize(
      ${input.sideEffectId}::text
    )
  `;
  const row = rows[0];
  if (
    rows.length !== 1
    || !row
    || row.userId !== input.expectedUserId
    || typeof row.clerkId !== "string"
    || typeof row.email !== "string"
    || !(row.deletedAt instanceof Date)
  ) {
    throw new Error("User account-deletion finalization returned an invalid result");
  }
  return row;
}
