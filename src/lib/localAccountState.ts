import { clearAnonymousCart, type CartStorage } from "./anonymousCart.ts";
import { clearCartSessionStorage, type CartSessionStorage } from "./cartSessionStorage.ts";
import { clearRecentlyViewed } from "./recentlyViewed.ts";

export const LOCAL_ACCOUNT_STATE_CLEARED_EVENT = "grainline:local-account-state-cleared";

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
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCAL_ACCOUNT_STATE_CLEARED_EVENT));
  }
}
