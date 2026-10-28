export type CartGiftSelection = Readonly<{
  giftNote: string;
  giftWrapping: boolean;
}>;

export function effectiveCartGiftSelection(
  selection: CartGiftSelection | undefined,
  offersGiftWrapping: boolean,
): CartGiftSelection {
  return Object.freeze({
    giftNote: selection?.giftNote ?? "",
    giftWrapping: offersGiftWrapping && selection?.giftWrapping === true,
  });
}
