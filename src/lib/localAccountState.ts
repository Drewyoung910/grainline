import { clearAnonymousCart, type CartStorage } from "./anonymousCart.ts";
import { clearCartGiftNotes, clearCartSessionStorage, type CartSessionStorage } from "./cartSessionStorage.ts";
import { clearRecentSearches, type RecentSearchStorage } from "./recentSearches.ts";
import { clearRecentlyViewed } from "./recentlyViewed.ts";

export const LOCAL_ACCOUNT_STATE_CLEARED_EVENT = "grainline:local-account-state-cleared";

export function clearSignedOutLocalAccountState({
  anonymousCartStorage,
  cartSessionStorage,
  recentSearchStorage,
}: {
  anonymousCartStorage?: CartStorage | null;
  cartSessionStorage?: CartSessionStorage | null;
  recentSearchStorage?: RecentSearchStorage | null;
} = {}): void {
  clearRecentlyViewed();
  clearRecentSearches(recentSearchStorage);
  clearAnonymousCart(anonymousCartStorage);
  clearCartSessionStorage({ includeAddress: true, storage: cartSessionStorage });
  clearCartGiftNotes(cartSessionStorage);
  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(LOCAL_ACCOUNT_STATE_CLEARED_EVENT));
  }
}
