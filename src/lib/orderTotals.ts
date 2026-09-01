type OrderTotalItem = {
  priceCents: number;
  quantity: number;
};

export type OrderTotalInput = {
  chargedTotalCents?: number | null;
  itemsSubtotalCents?: number | null;
  shippingAmountCents?: number | null;
  taxAmountCents?: number | null;
  giftWrappingPriceCents?: number | null;
  items?: readonly OrderTotalItem[];
};

export function orderItemsSubtotalCents(order: OrderTotalInput) {
  if (order.itemsSubtotalCents != null && order.itemsSubtotalCents > 0) {
    return order.itemsSubtotalCents;
  }

  return order.items?.reduce((sum, item) => sum + item.priceCents * item.quantity, 0) ?? 0;
}

export function orderTotalCents(
  order: OrderTotalInput,
  opts: { itemsSubtotalCents?: number } = {},
) {
  if (
    order.chargedTotalCents != null
    && Number.isSafeInteger(order.chargedTotalCents)
    && order.chargedTotalCents >= 0
  ) {
    return order.chargedTotalCents;
  }
  const itemsSubtotalCents = opts.itemsSubtotalCents ?? orderItemsSubtotalCents(order);
  return (
    itemsSubtotalCents +
    (order.shippingAmountCents ?? 0) +
    (order.taxAmountCents ?? 0) +
    (order.giftWrappingPriceCents ?? 0)
  );
}
