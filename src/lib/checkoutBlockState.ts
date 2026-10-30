import { userBlockPairIsBlocked } from "@/lib/blockAccess";

export const CHECKOUT_PAIR_UNAVAILABLE_MESSAGE = "This checkout is unavailable.";

export async function checkoutPairIsBlocked(
  buyerId: string,
  sellerUserId: string,
): Promise<boolean> {
  if (!buyerId || !sellerUserId || buyerId === sellerUserId) return true;
  return userBlockPairIsBlocked(buyerId, sellerUserId);
}
