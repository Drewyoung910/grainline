import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";

type SellerStripeClient = Pick<Prisma.TransactionClient, "sellerProfile">;

const sellerStripeOwnerSelect = {
  id: true,
  stripeAccountId: true,
  stripeAccountVersion: true,
  chargesEnabled: true,
  shipFromCountry: true,
} satisfies Prisma.SellerProfileSelect;

/**
 * Compatibility boundary for private Stripe state that is still authoritative
 * on SellerProfile. Keep provider callers behind this module so its internals
 * can move to fixed SellerProfilePrivate database operations after Phase 0 is
 * installed without another route-by-route conversion.
 */
export function sellerStripeOwnerState(
  userId: string,
  client: SellerStripeClient = prisma,
) {
  return client.sellerProfile.findUnique({
    where: { userId },
    select: sellerStripeOwnerSelect,
  });
}

export function bindSellerStripeAccount(
  client: SellerStripeClient,
  input: {
    sellerProfileId: string;
    stripeAccountId: string;
    stripeAccountVersion: string;
    stripeControllerType: string;
  },
) {
  return client.sellerProfile.update({
    where: { id: input.sellerProfileId },
    data: {
      stripeAccountId: input.stripeAccountId,
      chargesEnabled: false,
      stripeAccountVersion: input.stripeAccountVersion,
      stripeControllerType: input.stripeControllerType,
    },
    select: { id: true },
  });
}

export function sellerStripeReconciliationPage(
  cursorId: string | null,
  take: number,
  client: SellerStripeClient = prisma,
) {
  return client.sellerProfile.findMany({
    where: { stripeAccountId: { not: null } },
    ...(cursorId ? { cursor: { id: cursorId }, skip: 1 } : {}),
    orderBy: { id: "asc" },
    take,
    select: {
      id: true,
      stripeAccountId: true,
      stripeAccountVersion: true,
    },
  });
}

export function sellerStripeMirrorState(
  stripeAccountId: string,
  client: SellerStripeClient = prisma,
) {
  return client.sellerProfile.findFirst({
    where: { stripeAccountId },
    select: {
      id: true,
      userId: true,
      ownerAccountActive: true,
      chargesEnabled: true,
      stripeAccountId: true,
    },
  });
}

export function updateSellerStripeChargesEnabled(
  client: SellerStripeClient,
  sellerProfileId: string,
  chargesEnabled: boolean,
) {
  return client.sellerProfile.update({
    where: { id: sellerProfileId },
    data: { chargesEnabled },
    select: { id: true },
  });
}
