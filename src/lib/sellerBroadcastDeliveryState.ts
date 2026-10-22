type SellerBroadcastDeliverySeller = Readonly<{
  sellerProfileId: string;
  chargesEnabled: boolean;
  vacationMode: boolean;
}>;

export function canDeliverSellerBroadcast(
  broadcastSellerProfileId: string | null,
  seller: SellerBroadcastDeliverySeller | null,
) {
  return Boolean(
    broadcastSellerProfileId
      && seller
      && seller.sellerProfileId === broadcastSellerProfileId
      && seller.chargesEnabled
      && !seller.vacationMode,
  );
}
