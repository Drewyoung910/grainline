import { clearAnonymousCart, type CartStorage } from "./anonymousCart.ts";
import { clearCartSessionStorage, type CartSessionStorage } from "./cartSessionStorage.ts";
import { clearRecentlyViewed } from "./recentlyViewed.ts";

export function clearSignedOutLocalAccountState({
  anonymousCartStorage,
  cartSessionStorage,
}: {
  anonymousCartStorage?: CartStorage | null;
  cartSessionStorage?: CartSessionStorage | null;
} = {}): void {
  clearRecentlyViewed();
  clearAnonymousCart(anonymousCartStorage);
  clearCartSessionStorage({ includeAddress: true, storage: cartSessionStorage });
}
