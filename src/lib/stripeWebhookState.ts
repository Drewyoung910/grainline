export type StripeRefundLike = {
  id?: string;
  amount?: number;
  status?: string | null;
  created?: number | null;
  reason?: string | null;
};

export type CheckoutSellerState = {
  id: string;
  userId: string;
  chargesEnabled: boolean;
  stripeAccountId: string | null;
  user: { id: string; banned: boolean; deletedAt: Date | null } | null;
};

export function latestSuccessfulRefund(refunds: StripeRefundLike[]) {
  return refunds
    .filter((refund) => refund.status !== "failed")
    .sort((a, b) => (b.created ?? 0) - (a.created ?? 0))[0] ?? null;
}

export function parsePositiveInt(value: string | number | null | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function parseOptionalNonNegativeInt(value: string | number | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : null;
}

export function normalizeShippoRateObjectId(value: string | null | undefined): string | null {
  if (!value) return null;
  const normalized = value.trim().toLowerCase();
  return normalized === "pickup" || normalized === "fallback" ? null : value;
}

export function invalidCheckoutSellerReason(seller: CheckoutSellerState | null | undefined): string | null {
  if (!seller) return "Seller account could not be verified at payment completion.";
  if (seller.user?.banned) return "Seller account was suspended before payment completion.";
  if (seller.user?.deletedAt) return "Seller account was deleted before payment completion.";
  if (!seller.chargesEnabled) return "Seller Stripe account was disabled before payment completion.";
  if (!seller.stripeAccountId) return "Seller Stripe account was disconnected before payment completion.";
  return null;
}
