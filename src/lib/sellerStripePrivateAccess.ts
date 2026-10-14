import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerStripeClient = Pick<Prisma.TransactionClient, "$queryRaw">;

export type SellerStripeOwnerState = {
  id: string;
  stripeAccountId: string | null;
  stripeAccountVersion: string | null;
  chargesEnabled: boolean;
  shipFromCountry: string | null;
};

export type SellerStripeReconciliationState = Pick<
  SellerStripeOwnerState,
  "id" | "stripeAccountId" | "stripeAccountVersion"
>;

export type SellerStripeMirrorState = {
  id: string;
  userId: string;
  ownerAccountActive: boolean;
  chargesEnabled: boolean;
  stripeAccountId: string;
};

function optionalString(value: unknown): value is string | null {
  return value === null || typeof value === "string";
}

function validOwnerState(row: SellerStripeOwnerState | undefined): row is SellerStripeOwnerState {
  return Boolean(
    row
    && typeof row.id === "string"
    && optionalString(row.stripeAccountId)
    && optionalString(row.stripeAccountVersion)
    && typeof row.chargesEnabled === "boolean"
    && optionalString(row.shipFromCountry),
  );
}

/**
 * Fixed database-operation boundary for private Stripe state. Provider callers
 * never receive direct SellerProfilePrivate table authority.
 */
export async function sellerStripeOwnerState(
  userId: string,
  client: SellerStripeClient = prisma,
) {
  const rows = await client.$queryRaw<SellerStripeOwnerState[]>`
    SELECT id, "stripeAccountId", "stripeAccountVersion",
           "chargesEnabled", "shipFromCountry"
      FROM public.grainline_seller_stripe_owner_state(${userId}::text)
  `;
  if (rows.length > 1 || (rows[0] && !validOwnerState(rows[0]))) {
    throw new Error("Seller Stripe owner-state authority returned an invalid result");
  }
  return rows[0] ?? null;
}

export async function bindSellerStripeAccount(
  client: SellerStripeClient,
  input: {
    userId: string;
    sellerProfileId: string;
    stripeAccountId: string;
    stripeAccountVersion: string;
    stripeControllerType: string;
  },
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT public.grainline_seller_stripe_account_bind(
      ${input.userId}::text,
      ${input.sellerProfileId}::text,
      ${input.stripeAccountId}::text,
      ${input.stripeAccountVersion}::text,
      ${input.stripeControllerType}::text
    ) AS id
  `;
  if (rows.length !== 1 || rows[0]?.id !== input.sellerProfileId) {
    throw new Error("Seller Stripe account-bind authority returned an invalid result");
  }
  return rows[0];
}

export async function sellerStripeReconciliationPage(
  cursorId: string | null,
  take: number,
  client: SellerStripeClient = prisma,
) {
  const rows = await client.$queryRaw<SellerStripeReconciliationState[]>`
    SELECT id, "stripeAccountId", "stripeAccountVersion"
      FROM public.grainline_seller_stripe_reconciliation_page(
        ${cursorId}::text,
        ${take}::integer
      )
  `;
  const ids = new Set<string>();
  if (rows.length > take || rows.some((row) => {
    const valid = typeof row.id === "string"
      && !ids.has(row.id)
      && typeof row.stripeAccountId === "string"
      && optionalString(row.stripeAccountVersion);
    ids.add(row.id);
    return !valid;
  })) {
    throw new Error("Seller Stripe reconciliation authority returned an invalid result");
  }
  return rows;
}

export async function sellerStripeMirrorState(
  stripeAccountId: string,
  client: SellerStripeClient = prisma,
) {
  const rows = await client.$queryRaw<SellerStripeMirrorState[]>`
    SELECT id, "userId", "ownerAccountActive", "chargesEnabled", "stripeAccountId"
      FROM public.grainline_seller_stripe_mirror_state(${stripeAccountId}::text)
  `;
  const row = rows[0];
  const valid = row
    && typeof row.id === "string"
    && typeof row.userId === "string"
    && typeof row.ownerAccountActive === "boolean"
    && typeof row.chargesEnabled === "boolean"
    && row.stripeAccountId === stripeAccountId;
  if (rows.length > 1 || (row && !valid)) {
    throw new Error("Seller Stripe mirror-state authority returned an invalid result");
  }
  return valid ? row : null;
}

export async function updateSellerStripeChargesEnabled(
  client: SellerStripeClient,
  sellerProfileId: string,
  stripeAccountId: string,
  chargesEnabled: boolean,
) {
  const rows = await client.$queryRaw<Array<{ id: string }>>`
    SELECT public.grainline_seller_stripe_charges_update(
      ${sellerProfileId}::text,
      ${stripeAccountId}::text,
      ${chargesEnabled}::boolean
    ) AS id
  `;
  if (rows.length !== 1 || rows[0]?.id !== sellerProfileId) {
    throw new Error("Seller Stripe charges-update authority returned an invalid result");
  }
  return rows[0];
}
