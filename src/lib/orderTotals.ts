type OrderTotalItem = {
  priceCents: number;
  quantity: number;
};

export type OrderTotalInput = {
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
  const itemsSubtotalCents = opts.itemsSubtotalCents ?? orderItemsSubtotalCents(order);
  return (
    itemsSubtotalCents +
    (order.shippingAmountCents ?? 0) +
    (order.taxAmountCents ?? 0) +
    (order.giftWrappingPriceCents ?? 0)
  );
}
