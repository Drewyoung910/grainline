const PLATFORM_FEE_RATE = 0.05;
const MIN_SELLER_TRANSFER_CENTS = 100;

export type CheckoutAmountInput = {
  itemsSubtotalCents: number;
  shippingAmountCents: number;
  giftWrapCents: number;
};

export function calculateCheckoutAmounts({
  itemsSubtotalCents,
  shippingAmountCents,
  giftWrapCents,
}: CheckoutAmountInput) {
  const platformFeeCents = Math.round(itemsSubtotalCents * PLATFORM_FEE_RATE);
  const preTaxTotalCents = itemsSubtotalCents + shippingAmountCents + giftWrapCents;
  const sellerTransferBeforeMinimumCents = preTaxTotalCents - platformFeeCents;

  return {
    platformFeeCents,
    preTaxTotalCents,
    sellerTransferBeforeMinimumCents,
    sellerTransferAmountCents: Math.max(1, sellerTransferBeforeMinimumCents),
    belowMinimumSellerTransfer: sellerTransferBeforeMinimumCents < MIN_SELLER_TRANSFER_CENTS,
  };
}
