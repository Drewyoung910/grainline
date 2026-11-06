export const CART_ADDRESS_KEY = "grainline_cart_shipping_address";
export const CART_RATES_KEY = "grainline_cart_selected_rates";
export const CART_CHECKOUTS_KEY = "grainline_checkouts";
export const CART_GIFTS_KEY = "grainline_cart_gifts";

export type CartSessionStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getBrowserSessionStorage(): CartSessionStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

export function readCartSessionJson<T>(
  key: string,
  fallback: T,
  storage: CartSessionStorage | null = getBrowserSessionStorage(),
): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function writeCartSessionJson(
  key: string,
  value: unknown,
  storage: CartSessionStorage | null = getBrowserSessionStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function clearCartSessionStorage({
  includeAddress = true,
  storage = getBrowserSessionStorage(),
}: {
  includeAddress?: boolean;
  storage?: CartSessionStorage | null;
} = {}): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(CART_CHECKOUTS_KEY);
    storage.removeItem(CART_RATES_KEY);
    if (includeAddress) storage.removeItem(CART_ADDRESS_KEY);
    return true;
  } catch {
    return false;
  }
}

export function clearCartCheckoutSecrets(
  storage: CartSessionStorage | null = getBrowserSessionStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(CART_CHECKOUTS_KEY);
    return true;
  } catch {
    return false;
  }
}

// Gift notes survive a reload, so clearCartSessionStorage (which runs on every
// cart load and change) leaves them. They go at sign-out and after payment.
export function clearCartGiftNotes(
  storage: CartSessionStorage | null = getBrowserSessionStorage(),
): boolean {
  if (!storage) return false;
  try {
    storage.removeItem(CART_GIFTS_KEY);
    return true;
  } catch {
    return false;
  }
}
